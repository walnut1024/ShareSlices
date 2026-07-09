process.env.DATABASE_URL ??= "postgres://shareslices:shareslices@127.0.0.1:5432/shareslices";
process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-thirty-two-bytes";
process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:7456";
process.env.WEB_ORIGIN ??= "http://127.0.0.1:5173";
process.env.NODE_ENV ??= "test";
