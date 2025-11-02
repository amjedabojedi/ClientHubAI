import { Client } from '@replit/object-storage';

const client = new Client({
  bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8",
});

const { ok, value, error } = await client.list();

if (!ok) {
  console.error(error);
  process.exit(1);
}

console.log("Sample keys:");
console.log(Object.keys(value).slice(0, 20)); // print first 20 keys
