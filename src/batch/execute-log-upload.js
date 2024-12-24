const LogUploader = require('./s3-batch-log-01.js');

async function main() {
  const uploader = new LogUploader();
  await uploader.executeNow();
  process.exit(0);
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
}); 