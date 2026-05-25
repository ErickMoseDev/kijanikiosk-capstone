const express = require("express");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());

// In-memory store for demo purposes
const payments = {};

// POST /payments - initiate a payment
app.post("/payments", (req, res) => {
	const { amount, currency, method } = req.body;

	if (!amount || !currency || !method) {
		return res
			.status(400)
			.json({ error: "amount, currency, and method are required" });
	}

	if (typeof amount !== "number" || amount <= 0) {
		return res
			.status(400)
			.json({ error: "amount must be a positive number" });
	}

	const payment = {
		id: uuidv4(),
		amount,
		currency,
		method,
		status: "pending",
		createdAt: new Date().toISOString(),
	};

	payments[payment.id] = payment;
	return res.status(201).json(payment);
});

// GET /payments/:id - get payment status
app.get("/payments/:id", (req, res) => {
	const payment = payments[req.params.id];
	if (!payment) {
		return res.status(404).json({ error: "Payment not found" });
	}
	return res.json(payment);
});

// POST /payments/:id/capture - capture (confirm) a payment
app.post("/payments/:id/capture", (req, res) => {
	const payment = payments[req.params.id];
	if (!payment) {
		return res.status(404).json({ error: "Payment not found" });
	}
	if (payment.status !== "pending") {
		return res
			.status(409)
			.json({ error: `Payment is already ${payment.status}` });
	}

	payment.status = "captured";
	payment.capturedAt = new Date().toISOString();
	return res.json(payment);
});

// POST /payments/:id/refund - refund a captured payment
app.post("/payments/:id/refund", (req, res) => {
	const payment = payments[req.params.id];
	if (!payment) {
		return res.status(404).json({ error: "Payment not found" });
	}
	if (payment.status !== "captured") {
		return res
			.status(409)
			.json({ error: "Only captured payments can be refunded" });
	}

	payment.status = "refunded";
	payment.refundedAt = new Date().toISOString();
	return res.json(payment);
});

// Health check
app.get("/health", (_req, res) => {
	res.json({ status: "ok" });
});

module.exports = { app, payments };
