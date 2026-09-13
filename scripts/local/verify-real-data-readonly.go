package main

import (
	"context"
	"fmt"
	"os"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL não foi informada para a verificação somente leitura.")
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      1,
		MinConns:      0,
		ForceReadOnly: true,
		HealthTimeout: 10 * time.Second,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "Não foi possível preparar a verificação somente leitura.")
		os.Exit(1)
	}
	defer postgres.Close()

	var readOnly string
	if err := postgres.Pool().QueryRow(ctx, "show default_transaction_read_only").Scan(&readOnly); err != nil {
		fmt.Fprintln(os.Stderr, "Não foi possível confirmar o modo somente leitura.")
		os.Exit(1)
	}
	if readOnly != "on" {
		fmt.Fprintln(os.Stderr, "A conexão recusou o modo somente leitura; o ambiente local não será iniciado.")
		os.Exit(1)
	}

	fmt.Println("Banco real confirmado em modo somente leitura.")
}
