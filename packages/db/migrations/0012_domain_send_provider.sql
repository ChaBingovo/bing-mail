ALTER TABLE domains ADD COLUMN send_provider TEXT NOT NULL DEFAULT 'none' CHECK (send_provider IN ('none', 'cloudflare', 'resend'));
