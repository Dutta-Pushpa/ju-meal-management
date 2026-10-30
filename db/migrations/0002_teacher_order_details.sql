-- Teacher-facing item alternatives and audit fields for order cancellation.
ALTER TABLE order_items
  ADD COLUMN alternative_menu_item_id bigint REFERENCES menu_items (id) ON DELETE SET NULL;

ALTER TABLE orders
  ADD COLUMN cancelled_by bigint REFERENCES users (id) ON DELETE RESTRICT,
  ADD COLUMN cancel_reason text,
  ADD CONSTRAINT orders_cancellation_details_check
    CHECK (status = 'CANCELLED' OR (cancelled_by IS NULL AND cancel_reason IS NULL));

INSERT INTO app_settings (key, value, description)
VALUES (
  'ordering_disabled_dates',
  '[]'::jsonb,
  'Business dates on which teachers cannot place meal orders.'
)
ON CONFLICT (key) DO NOTHING;
