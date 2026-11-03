package purchase

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ovh-webui/server/internal/app"
	"github.com/ovh-webui/server/internal/config"
	"github.com/ovh-webui/server/internal/db"
	"github.com/ovh-webui/server/internal/logger"
	"github.com/ovh-webui/server/internal/storage"
	"github.com/ovh-webui/server/internal/types"
)

// 预订任务:库存里已出现所选配置,但购物车 eco/options 还没开放这条 addon。
// 预订要继续等(上架初期选项是陆续开放的),普通任务按显式选项对不上判死。
func TestPreorderWaitsForHardwareOptionToOpen(t *testing.T) {
	original := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = original })
	for _, tc := range []struct {
		name     string
		preorder bool
	}{
		{"preorder", true},
		{"normal", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			database, err := db.Open(dir)
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()
			lg := logger.New(filepath.Join(dir, "test.log"), slog.New(slog.NewTextHandler(io.Discard, nil)))
			st := app.NewState(storage.Paths{DataDir: dir}, config.New(database), lg, database)
			st.Accounts = []types.OVHAccount{{ID: "eu", Endpoint: "ovh-eu", Zone: "FR", AppKey: "test", AppSecret: "test", ConsumerKey: "test"}}
			addons, checkouts := 0, 0
			transport := preorderTransport(func(r *http.Request) (*http.Response, error) {
				body := "{}"
				p := r.URL.Path
				switch {
				case strings.Contains(p, "/order/catalog/public/eco"):
					body = `{"plans":[{"planCode":"27skle03-v1"}]}`
				case strings.HasSuffix(p, "/auth/time"):
					body = fmt.Sprint(time.Now().Unix())
				case strings.Contains(p, "/dedicated/server/datacenter/availabilities"):
					body = `[{"fqn":"27skle03-v1.ram-64g","datacenters":[{"datacenter":"gra","availability":"1H-low"}]}]`
				case strings.HasSuffix(p, "/order/cart") && r.Method == http.MethodPost:
					body = `{"cartId":"c1"}`
				case strings.HasSuffix(p, "/eco/options") && r.Method == http.MethodGet:
					body = `[{"planCode":"ram-32g-27skle03","prices":[{"duration":"P1M","pricingMode":"default"}]}]`
				case strings.HasSuffix(p, "/eco/options"):
					addons++
				case strings.HasSuffix(p, "/eco") && r.Method == http.MethodPost:
					body = `{"itemId":1}`
				case strings.Contains(p, "requiredConfiguration"):
					body = `[]`
				case strings.Contains(p, "checkout"):
					checkouts++
				}
				return &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
			})
			http.DefaultTransport = transport
			client, err := st.OVH.ClientFor("eu")
			if err != nil {
				t.Fatal(err)
			}
			client.Client = &http.Client{Transport: transport}
			item := &types.QueueItem{ID: "t", AccountID: "eu", PlanCode: "27skle03-v1", Datacenter: "gra",
				Preorder: tc.preorder, MaxRetries: 1, Options: []string{"ram-64g"}}
			outcome := PurchaseServer(context.Background(), st, item)
			if addons != 0 || checkouts != 0 {
				t.Fatalf("must not add addons or checkout: addons=%d checkouts=%d", addons, checkouts)
			}
			if tc.preorder {
				if !outcome.WaitingForCatalog || outcome.Fatal {
					t.Fatalf("preorder must keep waiting for the option: %+v", outcome)
				}
			} else if !outcome.Fatal {
				t.Fatalf("normal task with explicit missing option must be fatal: %+v", outcome)
			}
		})
	}
}
