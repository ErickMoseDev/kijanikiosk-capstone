const request = require('supertest');
const { app, payments } = require('../src/app');

// Reset in-memory store before each test
beforeEach(() => {
	Object.keys(payments).forEach((k) => delete payments[k]);
});

describe('POST /payments', () => {
	it('creates a payment and returns 201', async () => {
		const res = await request(app)
			.post('/payments')
			.send({ amount: 50, currency: 'KES', method: 'mpesa' });

		expect(res.status).toBe(201);
		expect(res.body).toMatchObject({
			amount: 50,
			currency: 'KES',
			method: 'mpesa',
			status: 'pending',
		});
		expect(res.body.id).toBeDefined();
	});

	it('returns 400 when required fields are missing', async () => {
		const res = await request(app).post('/payments').send({ amount: 50 });
		expect(res.status).toBe(400);
	});

	it('returns 400 when amount is not positive', async () => {
		const res = await request(app)
			.post('/payments')
			.send({ amount: -10, currency: 'KES', method: 'card' });
		expect(res.status).toBe(400);
	});
});

describe('GET /payments/:id', () => {
	it('returns a payment by id', async () => {
		const create = await request(app)
			.post('/payments')
			.send({ amount: 100, currency: 'USD', method: 'card' });

		const res = await request(app).get(`/payments/${create.body.id}`);
		expect(res.status).toBe(200);
		expect(res.body.id).toBe(create.body.id);
	});

	it('returns 404 for unknown id', async () => {
		const res = await request(app).get('/payments/nonexistent-id');
		expect(res.status).toBe(404);
	});
});

describe('POST /payments/:id/capture', () => {
	it('captures a pending payment', async () => {
		const create = await request(app)
			.post('/payments')
			.send({ amount: 200, currency: 'KES', method: 'mpesa' });

		const res = await request(app).post(
			`/payments/${create.body.id}/capture`,
		);
		expect(res.status).toBe(200);
		expect(res.body.status).toBe('captured');
	});

	it('returns 409 if payment is already captured', async () => {
		const create = await request(app)
			.post('/payments')
			.send({ amount: 200, currency: 'KES', method: 'mpesa' });

		await request(app).post(`/payments/${create.body.id}/capture`);
		const res = await request(app).post(
			`/payments/${create.body.id}/capture`,
		);
		expect(res.status).toBe(409);
	});
});

describe('POST /payments/:id/refund', () => {
	it('refunds a captured payment', async () => {
		const create = await request(app)
			.post('/payments')
			.send({ amount: 150, currency: 'KES', method: 'card' });

		await request(app).post(`/payments/${create.body.id}/capture`);
		const res = await request(app).post(
			`/payments/${create.body.id}/refund`,
		);
		expect(res.status).toBe(200);
		expect(res.body.status).toBe('refunded');
	});

	it('returns 409 if payment is not captured', async () => {
		const create = await request(app)
			.post('/payments')
			.send({ amount: 150, currency: 'KES', method: 'card' });

		const res = await request(app).post(
			`/payments/${create.body.id}/refund`,
		);
		expect(res.status).toBe(409);
	});
});

describe('GET /health', () => {
	it('returns ok', async () => {
		const res = await request(app).get('/health');
		expect(res.status).toBe(200);
		expect(res.body.status).toBe('ok');
	});
});
