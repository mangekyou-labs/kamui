const run = async () => {
  console.log(`Local time: ${Date.now()}`);
}

run().catch(e => {
  console.error('Error', e);
  process.exit(1);
})
