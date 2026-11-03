package admin

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/supabasehttp"
)

func parseHomePublicationImage(w http.ResponseWriter, r *http.Request) (string, io.Reader, func(), error) {
	r.Body = http.MaxBytesReader(w, r.Body, homePublicationImageLimit+(1<<20))
	if err := r.ParseMultipartForm(homePublicationImageLimit + (1 << 20)); err != nil {
		return "", nil, nil, fmt.Errorf("%w: invalid multipart form", ErrInvalidInput)
	}
	cleanup := func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}

	file, fileHeader, err := r.FormFile("file")
	if err != nil {
		cleanup()
		return "", nil, nil, fmt.Errorf("%w: file is required", ErrInvalidInput)
	}
	if fileHeader.Size <= 0 || fileHeader.Size > homePublicationImageLimit {
		file.Close()
		cleanup()
		return "", nil, nil, fmt.Errorf("%w: invalid file size", ErrInvalidInput)
	}

	buffer := make([]byte, 512)
	readBytes, err := file.Read(buffer)
	if err != nil && !errors.Is(err, io.EOF) {
		file.Close()
		cleanup()
		return "", nil, nil, fmt.Errorf("%w: could not read file", ErrInvalidInput)
	}
	buffer = buffer[:readBytes]
	contentType := strings.ToLower(strings.TrimSpace(http.DetectContentType(buffer)))
	if !isHomePublicationImageType(contentType) {
		file.Close()
		cleanup()
		return "", nil, nil, fmt.Errorf("%w: unsupported image type", ErrInvalidInput)
	}

	return contentType, io.MultiReader(bytes.NewReader(buffer), file), func() {
		file.Close()
		cleanup()
	}, nil
}

func isHomePublicationImageType(contentType string) bool {
	switch contentType {
	case "image/jpeg", "image/png", "image/webp":
		return true
	default:
		return false
	}
}

func homeImageExtension(contentType string) string {
	switch contentType {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	default:
		return ""
	}
}

func (repo Repository) uploadHomePublicationObject(ctx context.Context, objectPath string, contentType string, body io.Reader) error {
	if repo.projectURL == "" || repo.apiKey == "" {
		return errHomePublicationStorageNotConfigured
	}
	endpoint := fmt.Sprintf(
		"%s/storage/v1/object/%s/%s",
		repo.projectURL,
		url.PathEscape(homePublicationImageBucket),
		supabasehttp.EscapeObjectPath(objectPath),
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return err
	}
	supabasehttp.SetServiceAuth(request, repo.apiKey)
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Cache-Control", "31536000, immutable")
	request.Header.Set("x-upsert", "false")

	response, err := repo.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("%w: %v", errHomePublicationStorageOperation, err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		payload, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		message := strings.TrimSpace(string(payload))
		if message == "" {
			message = response.Status
		}
		return fmt.Errorf("%w: %s", errHomePublicationStorageOperation, message)
	}
	return nil
}

func (repo Repository) deleteHomePublicationObject(ctx context.Context, objectPath string) error {
	if strings.TrimSpace(objectPath) == "" {
		return nil
	}
	if repo.projectURL == "" || repo.apiKey == "" {
		return errHomePublicationStorageNotConfigured
	}
	if !strings.HasPrefix(objectPath, "platform/home/") {
		return ErrInvalidInput
	}
	endpoint := fmt.Sprintf(
		"%s/storage/v1/object/%s/%s",
		repo.projectURL,
		url.PathEscape(homePublicationImageBucket),
		supabasehttp.EscapeObjectPath(objectPath),
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	if err != nil {
		return err
	}
	supabasehttp.SetServiceAuth(request, repo.apiKey)

	response, err := repo.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("%w: %v", errHomePublicationStorageOperation, err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		payload, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("%w: %s", errHomePublicationStorageOperation, strings.TrimSpace(string(payload)))
	}
	return nil
}

func (repo Repository) homePublicationPublicURL(objectPath string) string {
	return supabasehttp.PublicObjectURL(repo.projectURL, homePublicationImageBucket, objectPath)
}
