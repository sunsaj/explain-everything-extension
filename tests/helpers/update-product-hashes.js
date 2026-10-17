import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  APPROVED_PRODUCT_HASHES_URL,
  createProductHashInventory,
  serializeProductHashInventory
} from "./product-attestation.js";

const extensionRoot = fileURLToPath(new URL("../../", import.meta.url));
const approvedPath = fileURLToPath(APPROVED_PRODUCT_HASHES_URL);
const mode = process.argv[2];

if (!["--check", "--write"].includes(mode)) {
  console.error("Usage: node tests/helpers/update-product-hashes.js --check|--write");
  process.exitCode = 2;
} else {
  const inventory = await createProductHashInventory(extensionRoot);
  const serialized = serializeProductHashInventory(inventory);

  if (mode === "--write") {
    await writeFile(approvedPath, serialized, "utf8");
    console.log(
      `Wrote approved product hash inventory for ${inventory.files.length} files.`
    );
  } else {
    const approved = await readFile(approvedPath, "utf8").catch(() => "");
    if (approved !== serialized) {
      console.error(
        "Approved product hash inventory is stale. Review product changes, then run with --write."
      );
      process.exitCode = 1;
    } else {
      console.log(
        `Approved product hash inventory is current for ${inventory.files.length} files.`
      );
    }
  }
}
