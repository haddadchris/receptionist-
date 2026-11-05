// Point every DB call in tests at the dedicated test database.
process.env.TEST_DATABASE_URL ??= "postgres://fekerte:fekerte@localhost:5432/fekerte_test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.APP_URL = "http://localhost:3000";
process.env.LOG_LEVEL = "error";
process.env.WHATSAPP_PROVIDER = "mock";
process.env.LLM_PROVIDER = "mock";
