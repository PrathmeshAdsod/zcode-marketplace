ALTER TABLE purchases ADD COLUMN provider_approval TEXT;

ALTER TABLE inbox ADD COLUMN capture_id TEXT;

CREATE INDEX paypal_reversal_capture ON inbox(subject,capture_id)
WHERE provider='paypal-sandbox' AND event_type='PAYMENT.CAPTURE.REVERSED';
