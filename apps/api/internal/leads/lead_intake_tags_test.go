package leads

import (
	"errors"
	"fmt"
	"reflect"
	"testing"
)

func TestImportAutomaticIntakePreservesCSVAndQueueTags(t *testing.T) {
	const csvTag = "11111111-1111-4111-8111-111111111111"
	const queueTag = "22222222-2222-4222-8222-222222222222"
	for _, name := range []string{"new import", "import reentry"} {
		t.Run(name, func(t *testing.T) {
			input := createInput{ImportMode: true, TagIDs: []string{csvTag}, AutoDistribute: boolPointer(true)}
			merged, err := leadIntakeTagIDs(input, []string{queueTag, csvTag})
			if err != nil || !reflect.DeepEqual(merged, []string{csvTag, queueTag}) {
				t.Fatalf("CSV or queue tags were discarded: %#v %v", merged, err)
			}
			if !reflect.DeepEqual(input.TagIDs, []string{csvTag}) {
				t.Fatal("routing mutated original import payload")
			}
		})
	}
	legacy, err := leadIntakeTagIDs(createInput{TagIDs: []string{csvTag}}, []string{queueTag})
	if err != nil || !reflect.DeepEqual(legacy, []string{csvTag, queueTag}) {
		t.Fatal("manual creation discarded selected tags during routing")
	}
	input := createInput{ImportMode: true, TagIDs: []string{csvTag}}
	merged, err := leadIntakeTagIDs(input, nil)
	if err != nil || !reflect.DeepEqual(merged, input.TagIDs) {
		t.Fatal("unmatched automatic queue discarded CSV tags")
	}
}

func TestImportAutomaticTagOverflowAndInvalidReferenceFailBeforeMutation(t *testing.T) {
	tags := make([]string, 50)
	for index := range tags {
		tags[index] = fmt.Sprintf("33333333-3333-4333-8333-%012d", index)
	}
	if _, err := leadIntakeTagIDs(createInput{ImportMode: true, TagIDs: tags}, []string{"44444444-4444-4444-8444-444444444444"}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("routing silently truncated more than 50 tags: %v", err)
	}
	if _, err := leadIntakeTagIDs(createInput{ImportMode: true, TagIDs: tags}, []string{tags[0]}); err != nil {
		t.Fatalf("duplicate routing tag should not count twice: %v", err)
	}
	if _, err := leadIntakeTagIDs(createInput{ImportMode: true}, []string{"invalid"}); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("invalid routing tag reached mutation: %v", err)
	}
}
