package developments

import (
	"context"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgproto3"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Exercise actual pgx Row.Scan (including nullable lead_id and JSON) and the
// SQL sent by the helper. This in-memory protocol is not a PostgreSQL lock test.
func TestReservationMutationPGXProtocolPreservesLockOrderAndNullableBinding(t *testing.T) {
	for _, linked := range []bool{false, true} {
		t.Run(fmt.Sprintf("linked=%t", linked), func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			frontend, backend := net.Pipe()
			defer frontend.Close()
			done := make(chan error, 1)
			go func() { done <- serveReservationLockProtocol(backend, linked) }()
			config, err := pgx.ParseConfig("postgres://synthetic@fixture.invalid/synthetic?sslmode=disable")
			if err != nil {
				t.Fatal(err)
			}
			config.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
			config.LookupFunc = func(context.Context, string) ([]string, error) { return []string{"127.0.0.1"}, nil }
			config.DialFunc = func(context.Context, string, string) (net.Conn, error) { return frontend, nil }
			connection, err := pgx.ConnectConfig(ctx, config)
			if err != nil {
				t.Fatal(err)
			}
			defer connection.Close(context.Background())
			tx, err := connection.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			reservation, err := lockReservationForMutationTx(ctx, tx, tenant.Context{
				OrganizationID: testUUID, UserID: testUUID,
				Permissions: []string{permissions.PropertyManage, permissions.LeadViewOwn},
			}, testUUID, testUUID)
			if err != nil || (reservation.LeadID != nil) != linked {
				t.Fatalf("pgx lock result: %#v %v", reservation, err)
			}
			if err := tx.Rollback(ctx); err != nil {
				t.Fatal(err)
			}
			if err := connection.Close(ctx); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
		})
	}
}

func serveReservationLockProtocol(connection net.Conn, linked bool) error {
	defer connection.Close()
	backend := pgproto3.NewBackend(connection, connection)
	if _, err := backend.ReceiveStartupMessage(); err != nil {
		return err
	}
	backend.Send(&pgproto3.AuthenticationOk{})
	backend.Send(&pgproto3.ParameterStatus{Name: "server_version", Value: "17.0"})
	backend.Send(&pgproto3.ParameterStatus{Name: "client_encoding", Value: "UTF8"})
	backend.Send(&pgproto3.ParameterStatus{Name: "standard_conforming_strings", Value: "on"})
	backend.Send(&pgproto3.ReadyForQuery{TxStatus: 'I'})
	if err := backend.Flush(); err != nil {
		return err
	}
	step := 0
	for {
		message, err := backend.Receive()
		if err != nil {
			return err
		}
		if _, terminated := message.(*pgproto3.Terminate); terminated {
			return nil
		}
		query, ok := message.(*pgproto3.Query)
		if !ok {
			return fmt.Errorf("unexpected pgx packet %T", message)
		}
		sql := strings.ToLower(strings.TrimSpace(query.String))
		state := byte('T')
		switch {
		case sql == "begin":
			backend.Send(&pgproto3.CommandComplete{CommandTag: []byte("BEGIN")})
		case sql == "rollback":
			want := 2
			if linked {
				want = 4
			}
			if step != want {
				return fmt.Errorf("pgx issued %d lookups, want %d", step, want)
			}
			state = 'I'
			backend.Send(&pgproto3.CommandComplete{CommandTag: []byte("ROLLBACK")})
		case strings.Contains(sql, "select reservation.lead_id::text"):
			if step != 0 || strings.Contains(sql, "for update") {
				return fmt.Errorf("reservation locked during discovery")
			}
			step++
			var lead []byte
			if linked {
				lead = []byte(testUUID)
			}
			sendReservationProtocolRow(backend, []uint32{25}, [][]byte{lead})
		case strings.Contains(sql, "from public.leads as lead"):
			if !linked || step != 1 || !strings.Contains(sql, "for share of lead") {
				return fmt.Errorf("lead lock was not first")
			}
			step++
			sendReservationProtocolRow(backend, []uint32{25, 25}, [][]byte{[]byte(testUUID), []byte("")})
		case strings.Contains(sql, "private.queue_pool_read_access"):
			if !linked || step != 2 {
				return fmt.Errorf("private pool projection preceded the lead lock")
			}
			step++
			sendReservationProtocolRow(backend, []uint32{16}, [][]byte{nil})
		case strings.Contains(sql, "select to_jsonb(reservation)"):
			want := 1
			var leadID *string
			if linked {
				want = 3
				leadID = activationText(testUUID)
			}
			if step != want || !strings.Contains(sql, "for update") {
				return fmt.Errorf("reservation lock preceded authorization")
			}
			step++
			sendReservationProtocolRow(backend, []uint32{3802}, [][]byte{reservationLockJSON(leadID)})
		default:
			return fmt.Errorf("unexpected reservation SQL")
		}
		backend.Send(&pgproto3.ReadyForQuery{TxStatus: state})
		if err := backend.Flush(); err != nil {
			return err
		}
	}
}

func sendReservationProtocolRow(backend *pgproto3.Backend, oids []uint32, values [][]byte) {
	fields := make([]pgproto3.FieldDescription, len(oids))
	for index, oid := range oids {
		fields[index] = pgproto3.FieldDescription{Name: []byte(fmt.Sprintf("field%d", index)), DataTypeOID: oid, DataTypeSize: -1, TypeModifier: -1}
	}
	backend.Send(&pgproto3.RowDescription{Fields: fields})
	backend.Send(&pgproto3.DataRow{Values: values})
	backend.Send(&pgproto3.CommandComplete{CommandTag: []byte("SELECT 1")})
}
