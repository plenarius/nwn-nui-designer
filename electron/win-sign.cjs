// electron-builder's Windows signing hook (electron-builder.yml): each file it signs (the app, the installer, the
// uninstaller) is signed with Azure Artifact Signing through jsign. release.yml fetches the jar (JSIGN_JAR) and the
// access token (NUID_SIGN_TOKEN); without them a file stays unsigned, unless NUID_REQUIRE_SIGNING is set.
const { execFileSync } = require("node:child_process");
const { appendFileSync } = require("node:fs");

exports.default = async function sign(configuration) {
  const file = configuration.path;
  const jar = process.env.JSIGN_JAR;
  if (!process.env.NUID_SIGN_TOKEN || !jar) {
    if (process.env.NUID_REQUIRE_SIGNING) throw new Error(`${file}: no signing token or jsign`);
    console.log(`  not signed (no token): ${file}`);
    return;
  }
  // The token is read from the environment (env:), so it is never on a command line.
  execFileSync(
    "java",
    ["-jar", jar, "--storetype", "TRUSTEDSIGNING", "--keystore", "eus.codesigning.azure.net", "--storepass", "env:NUID_SIGN_TOKEN", "--alias", "orthartifacts/orthca-public", "--tsaurl", "http://timestamp.acs.microsoft.com", "--tsmode", "RFC3161", file],
    { stdio: "inherit" },
  );
  if (process.env.NUID_SIGNED_LOG) appendFileSync(process.env.NUID_SIGNED_LOG, `${file}\n`);
};
