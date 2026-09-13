package properties

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestPropertyListProjectionRespectsPostgresFunctionArgumentLimit(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}

	listStart := strings.Index(string(source), "func (repo Repository) List(")
	statsStart := strings.Index(string(source), "func (repo Repository) Stats(")
	if listStart < 0 || statsStart <= listStart {
		t.Fatal("property list query boundary was not found")
	}

	argumentCounts, err := jsonbBuildObjectArgumentCounts(string(source)[listStart:statsStart])
	if err != nil {
		t.Fatal(err)
	}
	if len(argumentCounts) == 0 {
		t.Fatal("property list projection must keep an explicit jsonb_build_object projection")
	}

	const postgresFunctionArgumentLimit = 100
	for index, count := range argumentCounts {
		if count > postgresFunctionArgumentLimit {
			t.Errorf(
				"property list jsonb_build_object call %d has %d arguments; PostgreSQL accepts at most %d",
				index+1,
				count,
				postgresFunctionArgumentLimit,
			)
		}
	}
}

func jsonbBuildObjectArgumentCounts(source string) ([]int, error) {
	const functionCall = "jsonb_build_object("
	counts := make([]int, 0, 2)

	for searchFrom := 0; ; {
		relativeStart := strings.Index(source[searchFrom:], functionCall)
		if relativeStart < 0 {
			return counts, nil
		}

		argumentStart := searchFrom + relativeStart + len(functionCall)
		depth := 1
		commas := 0
		hasArgument := false
		inSingleQuote := false
		closed := false

		for index := argumentStart; index < len(source); index++ {
			character := source[index]
			if inSingleQuote {
				if character == '\'' {
					if index+1 < len(source) && source[index+1] == '\'' {
						index++
						continue
					}
					inSingleQuote = false
				}
				continue
			}

			switch character {
			case '\'':
				inSingleQuote = true
				hasArgument = true
			case '(':
				depth++
				hasArgument = true
			case ')':
				depth--
				if depth == 0 {
					count := 0
					if hasArgument {
						count = commas + 1
					}
					counts = append(counts, count)
					searchFrom = index + 1
					closed = true
					break
				}
			case ',':
				if depth == 1 {
					commas++
				}
			default:
				if depth == 1 && !strings.ContainsRune(" \t\r\n", rune(character)) {
					hasArgument = true
				}
			}

			if closed {
				break
			}
		}
		if !closed {
			return nil, fmt.Errorf("unterminated jsonb_build_object call in property list query")
		}
	}
}
