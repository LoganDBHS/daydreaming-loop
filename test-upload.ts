import { createServer } from './src/dashboard/index.js';

async function main() {
  console.log('Starting server...');
  createServer(3001);

  // Wait for server to start
  await new Promise(r => setTimeout(r, 1000));

  // Test document upload
  console.log('Testing document upload...');
  try {
    const res = await fetch('http://localhost:3001/api/concepts/document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Neural networks are computational models inspired by the brain. They consist of layers of interconnected nodes that process information. Deep learning uses multiple layers to learn hierarchical representations of data.',
        filename: 'test.txt',
        domain: 'AI',
      }),
    });
    const data = await res.json();
    console.log('Response status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));
  } catch (e: any) {
    console.error('Fetch error:', e.message);
  }

  process.exit(0);
}

main();
