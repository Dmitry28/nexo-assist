import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '@/app.module';
import { configureApp } from '@/app.setup';

// Must match API_PREFIX / API_VERSION defaults — k8s probes target these exact paths.
const PREFIX = '/api/v1';

describe('App (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Same pipeline as production (prefix, versioning, CORS, helmet).
    // ValidationPipe is wired globally via APP_PIPE in AppModule — no extra setup needed.
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it(`GET ${PREFIX}/health/live -> 200`, () => {
    return request(app.getHttpServer())
      .get(`${PREFIX}/health/live`)
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('ok'));
  });

  it(`GET ${PREFIX}/health/ready -> 200`, () => {
    return request(app.getHttpServer())
      .get(`${PREFIX}/health/ready`)
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('ok'));
  });

  it(`GET ${PREFIX}/metrics exposes Prometheus metrics`, () => {
    return request(app.getHttpServer())
      .get(`${PREFIX}/metrics`)
      .expect(200)
      .expect((res) => expect(res.text).toContain('process_cpu_seconds_total'));
  });

  it(`POST ${PREFIX}/users creates, GET ${PREFIX}/users/:id reads`, async () => {
    const create = await request(app.getHttpServer())
      .post(`${PREFIX}/users`)
      .send({ email: 'e2e@example.com', name: 'E2E User' })
      .expect(201);

    const { id } = create.body;
    expect(id).toBeDefined();

    await request(app.getHttpServer())
      .get(`${PREFIX}/users/${id}`)
      .expect(200)
      .expect((res) => expect(res.body.email).toBe('e2e@example.com'));
  });

  it(`POST ${PREFIX}/users rejects invalid payloads`, () => {
    return request(app.getHttpServer())
      .post(`${PREFIX}/users`)
      .send({ email: 'not-an-email', name: 'x', extra: 'nope' })
      .expect(400);
  });
});
