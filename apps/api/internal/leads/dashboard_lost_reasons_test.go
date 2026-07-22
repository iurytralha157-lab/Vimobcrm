package leads

import "testing"

func TestBuildLostReasonBucketsOrdersHighestCountFirst(t *testing.T) {
	deals := []LostDealDetail{
		{LostReason: "Sem interesse"},
		{LostReason: "Não respondeu"},
		{LostReason: "Não respondeu"},
		{LostReason: "Não respondeu"},
		{LostReason: "Imóvel fora do perfil"},
		{LostReason: "Imóvel fora do perfil"},
	}

	buckets := buildLostReasonBuckets(deals, int64(len(deals)))
	if len(buckets) < 3 {
		t.Fatalf("buildLostReasonBuckets() returned %d buckets, want at least 3", len(buckets))
	}
	if buckets[0].Count != 3 {
		t.Fatalf("first bucket count = %d, want 3", buckets[0].Count)
	}
	for index := 1; index < len(buckets); index++ {
		if buckets[index-1].Count < buckets[index].Count {
			t.Fatalf("buckets are not sorted descending: %#v", buckets)
		}
	}
}
