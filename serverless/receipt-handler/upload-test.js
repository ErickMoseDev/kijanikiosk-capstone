// serverless/receipt-handler/upload-test.js
//
// Run with: node upload-test.js
//
// Uploads a test receipt JSON to the local S3 server (port 4569) to trigger
// the processReceiptUpload Lambda. The serverless stack must already be running:
//   sls offline start
//
// Uses @aws-sdk/client-s3 — already a project dependency, no extra install needed.
// Alternative: aws CLI (if installed):
//   aws --endpoint-url http://localhost:4569 s3 cp /tmp/receipt-ORD-001.json \
//       s3://kk-payments-receipts/receipt-ORD-001.json --region af-south-1

const {
	S3Client,
	CreateBucketCommand,
	PutObjectCommand,
} = require('@aws-sdk/client-s3');

const client = new S3Client({
	endpoint: 'http://localhost:4569',
	region: 'af-south-1',
	forcePathStyle: true, // required for local S3 servers
	credentials: { accessKeyId: 'S3RVER', secretAccessKey: 'S3RVER' },
});

const BUCKET = 'kk-payments-receipts';

async function uploadTestFile() {
	// Create bucket (idempotent — safe to call even if it already exists)
	try {
		await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
		console.log(`Bucket created: ${BUCKET}`);
	} catch (err) {
		if (
			err.name !== 'BucketAlreadyExists' &&
			err.name !== 'BucketAlreadyOwnedByYou'
		) {
			throw err;
		}
		console.log('Bucket already exists — continuing.');
	}

	await client.send(
		new PutObjectCommand({
			Bucket: BUCKET,
			Key: 'receipt-ORD-001.json',
			Body: JSON.stringify({
				orderId: 'ORD-001',
				amount: 2500,
				currency: 'KES',
			}),
			ContentType: 'application/json',
		}),
	);

	console.log(
		'Uploaded receipt-ORD-001.json → switch to Terminal 1 to see the trigger log.',
	);
}

uploadTestFile().catch(console.error);
