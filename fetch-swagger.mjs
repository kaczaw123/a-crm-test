async function run() {
  const res = await fetch('https://developer.apilo.com/uploads/apilo/swagger.json');
  const swagger = await res.json();
  const schemas = swagger.components?.schemas || {};
  
  for (const [name, schema] of Object.entries(schemas)) {
     if (name.includes('Address')) {
        const props = Object.keys(schema.properties || {});
        if (props.includes('nip') || props.includes('vatId') || props.includes('company') || props.includes('companyName')) {
           console.log(`Schema ${name} has NIP/Company:`, props);
        }
     }
  }
}
run();
