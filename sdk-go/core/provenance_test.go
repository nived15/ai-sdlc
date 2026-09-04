package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateProvenance(t *testing.T) {
	p := CreateProvenance("gpt-5", "copilot", "abc123")
	assert.Equal(t, "gpt-5", p.Model)
	assert.Equal(t, "copilot", p.Tool)
	assert.Equal(t, "abc123", p.PromptHash)
	assert.NotEmpty(t, p.Timestamp)
	assert.Equal(t, ReviewPending, p.ReviewDecision)
	assert.Empty(t, p.HumanReviewer)
}

func TestCreateProvenanceWithOptions(t *testing.T) {
	p := CreateProvenance("gpt-5", "vscode", "hash",
		WithTimestamp("2024-01-01T00:00:00Z"),
		WithHumanReviewer("alice"),
		WithReviewDecision(ReviewApproved),
	)
	assert.Equal(t, "2024-01-01T00:00:00Z", p.Timestamp)
	assert.Equal(t, "alice", p.HumanReviewer)
	assert.Equal(t, ReviewApproved, p.ReviewDecision)
}

func TestProvenanceAnnotationRoundTrip(t *testing.T) {
	original := &ProvenanceRecord{
		Model:          "gpt-5",
		Tool:           "copilot",
		PromptHash:     "abc123",
		Timestamp:      "2024-01-01T00:00:00Z",
		HumanReviewer:  "alice",
		ReviewDecision: ReviewApproved,
	}

	annotations := ProvenanceToAnnotations(original)
	assert.Len(t, annotations, 6)
	assert.Equal(t, "gpt-5", annotations[ProvenanceAnnotationPrefix+"model"])

	restored := ProvenanceFromAnnotations(annotations)
	require.NotNil(t, restored)
	assert.Equal(t, original.Model, restored.Model)
	assert.Equal(t, original.Tool, restored.Tool)
	assert.Equal(t, original.PromptHash, restored.PromptHash)
	assert.Equal(t, original.Timestamp, restored.Timestamp)
	assert.Equal(t, original.HumanReviewer, restored.HumanReviewer)
	assert.Equal(t, original.ReviewDecision, restored.ReviewDecision)
}

func TestProvenanceFromAnnotationsMissing(t *testing.T) {
	result := ProvenanceFromAnnotations(map[string]string{
		ProvenanceAnnotationPrefix + "model": "gpt-5",
	})
	assert.Nil(t, result)
}

func TestProvenanceWithoutReviewer(t *testing.T) {
	p := &ProvenanceRecord{
		Model:          "gpt-5",
		Tool:           "copilot",
		PromptHash:     "abc",
		Timestamp:      "2024-01-01T00:00:00Z",
		ReviewDecision: ReviewPending,
	}
	annotations := ProvenanceToAnnotations(p)
	assert.Len(t, annotations, 5) // no humanReviewer key
}

func TestValidateProvenance(t *testing.T) {
	valid, missing := ValidateProvenance(map[string]string{
		"model":          "gpt-5",
		"tool":           "copilot",
		"promptHash":     "abc",
		"timestamp":      "2024-01-01T00:00:00Z",
		"reviewDecision": "approved",
	})
	assert.True(t, valid)
	assert.Empty(t, missing)
}

func TestValidateProvenanceMissing(t *testing.T) {
	valid, missing := ValidateProvenance(map[string]string{
		"model": "gpt-5",
	})
	assert.False(t, valid)
	assert.Contains(t, missing, "tool")
	assert.Contains(t, missing, "promptHash")
	assert.Contains(t, missing, "timestamp")
	assert.Contains(t, missing, "reviewDecision")
}
