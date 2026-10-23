package properties

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgproto3"
	"github.com/jackc/pgx/v5/pgxpool"
)

// The real pool/driver talks only to net.Pipe. This exercises connection
// acquisition without a socket, external database, credentials or SQL writes.
func TestPropertySchemaInspectionCompletesInsideSaturatedTransactionPool(t *testing.T) {
	for _, capacity := range []int32{1, 8} {
		t.Run(fmt.Sprintf("MaxConns%d", capacity), func(t *testing.T) {
			config, err := pgxpool.ParseConfig("postgres://synthetic:synthetic@127.0.0.1/synthetic?sslmode=disable&default_query_exec_mode=simple_protocol")
			if err != nil {
				t.Fatal(err)
			}
			config.MaxConns, config.MinConns = capacity, 0
			config.ConnConfig.LookupFunc = func(context.Context, string) ([]string, error) { return []string{"127.0.0.1"}, nil }
			var queries atomic.Int32
			config.ConnConfig.DialFunc = func(context.Context, string, string) (net.Conn, error) {
				client, server := net.Pipe()
				go serveCatalogInspectionProtocol(server, &queries)
				return client, nil
			}
			pool, err := pgxpool.NewWithConfig(context.Background(), config)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(pool.Close)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			transactions := make([]pgx.Tx, 0, capacity)
			for index := int32(0); index < capacity; index++ {
				tx, err := pool.Begin(ctx)
				if err != nil {
					t.Fatal(err)
				}
				transactions = append(transactions, tx)
				t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
			}
			// Control: reacquiring from the saturated pool cannot progress.
			controlContext, controlCancel := context.WithTimeout(ctx, 30*time.Millisecond)
			var control bool
			controlError := pool.QueryRow(controlContext, "select true").Scan(&control)
			controlCancel()
			if !errors.Is(controlError, context.DeadlineExceeded) || queries.Load() != 0 {
				t.Fatalf("saturated control = %v, queries=%d", controlError, queries.Load())
			}
			var wait sync.WaitGroup
			failures := make(chan error, capacity)
			for _, transaction := range transactions {
				wait.Add(1)
				go func(tx pgx.Tx) {
					defer wait.Done()
					for _, column := range []string{"latitude", "longitude", "default_condominium_fee"} {
						found, err := tableHasColumn(ctx, tx, "property_condominiums", column)
						if err != nil || !found {
							failures <- fmt.Errorf("inspection %s: found=%t error=%v", column, found, err)
							return
						}
					}
				}(transaction)
			}
			wait.Wait()
			close(failures)
			for failure := range failures {
				t.Error(failure)
			}
			if queries.Load() != capacity*3 || pool.Stat().TotalConns() != capacity {
				t.Fatalf("inspection escaped transactions: queries=%d connections=%d", queries.Load(), pool.Stat().TotalConns())
			}
		})
	}
}

func serveCatalogInspectionProtocol(connection net.Conn, queries *atomic.Int32) {
	defer connection.Close()
	backend := pgproto3.NewBackend(connection, connection)
	if _, err := backend.ReceiveStartupMessage(); err != nil {
		return
	}
	backend.Send(&pgproto3.AuthenticationOk{})
	backend.Send(&pgproto3.ParameterStatus{Name: "server_version", Value: "17.0"})
	backend.Send(&pgproto3.ParameterStatus{Name: "client_encoding", Value: "UTF8"})
	backend.Send(&pgproto3.ParameterStatus{Name: "standard_conforming_strings", Value: "on"})
	backend.Send(&pgproto3.BackendKeyData{ProcessID: 1, SecretKey: []byte{0, 0, 0, 1}})
	backend.Send(&pgproto3.ReadyForQuery{TxStatus: 'I'})
	if err := backend.Flush(); err != nil {
		return
	}
	state := byte('I')
	for {
		message, err := backend.Receive()
		if err != nil {
			return
		}
		query, ok := message.(*pgproto3.Query)
		if !ok {
			return
		}
		switch sql := strings.TrimSpace(strings.ToLower(query.String)); {
		case sql == "begin":
			state = 'T'
			backend.Send(&pgproto3.CommandComplete{CommandTag: []byte("BEGIN")})
		case sql == "rollback":
			state = 'I'
			backend.Send(&pgproto3.CommandComplete{CommandTag: []byte("ROLLBACK")})
		case strings.Contains(sql, "information_schema.columns"):
			queries.Add(1)
			backend.Send(&pgproto3.RowDescription{Fields: []pgproto3.FieldDescription{{Name: []byte("exists"), DataTypeOID: 16, DataTypeSize: 1, TypeModifier: -1}}})
			backend.Send(&pgproto3.DataRow{Values: [][]byte{[]byte("t")}})
			backend.Send(&pgproto3.CommandComplete{CommandTag: []byte("SELECT 1")})
		default:
			return
		}
		backend.Send(&pgproto3.ReadyForQuery{TxStatus: state})
		if err := backend.Flush(); err != nil {
			return
		}
	}
}
