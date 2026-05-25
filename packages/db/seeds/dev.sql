INSERT INTO users (id, name, api_token)
VALUES ('user_default', 'Default', 'dev-token')
ON CONFLICT(id) DO NOTHING;

