package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type sourceFact struct {
	File  string `json:"file"`
	Line  int    `json:"line"`
	Value string `json:"value"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) != 2 {
		return fmt.Errorf("usage: go-source-inventory <directory>")
	}
	directory := os.Args[1]
	facts := []sourceFact{}
	err := filepath.WalkDir(directory, func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			return nil
		}
		relative, err := filepath.Rel(directory, name)
		if err != nil {
			return err
		}
		files := token.NewFileSet()
		file, err := parser.ParseFile(files, name, nil, 0)
		if err != nil {
			return err
		}
		add := func(literal *ast.BasicLit) error {
			value, err := strconv.Unquote(literal.Value)
			if err != nil || literal.Kind != token.STRING {
				return fmt.Errorf("%s: expected a string literal", files.Position(literal.Pos()))
			}
			facts = append(facts, sourceFact{filepath.ToSlash(relative), files.Position(literal.Pos()).Line, value})
			return nil
		}
		return collectRoutes(files, file, add)
	})
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(facts)
}

func collectRoutes(files *token.FileSet, file *ast.File, add func(*ast.BasicLit) error) error {
	var routeErr error
	ast.Inspect(file, func(node ast.Node) bool {
		if routeErr != nil {
			return false
		}
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || (selector.Sel.Name != "Handle" && selector.Sel.Name != "HandleFunc") {
			return true
		}
		if len(call.Args) != 2 {
			routeErr = fmt.Errorf("%s: expected a ServeMux registration", files.Position(call.Pos()))
			return false
		}
		literal, ok := call.Args[0].(*ast.BasicLit)
		if !ok {
			routeErr = fmt.Errorf("%s: use a literal ServeMux pattern for OpenAPI parity", files.Position(call.Pos()))
			return false
		}
		routeErr = add(literal)
		return routeErr == nil
	})
	return routeErr
}
