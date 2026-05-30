const axios = require("axios");

/**
 * Fetches and parses a Stellar TOML file from a given home domain.
 *
 * @param {string} homeDomain - The home domain to fetch TOML from (e.g., "stellar.org")
 * @param {number} [timeout=5000] - Request timeout in milliseconds
 * @returns {Promise<Object|null>} Parsed TOML object or null if not found/unreachable
 */
async function fetchStellarToml(homeDomain, timeout = 5000) {
  if (!homeDomain) return null;

  try {
    // Construct the TOML URL
    const tomlUrl = `https://${homeDomain}/.well-known/stellar.toml`;

    // Fetch the TOML file
    const response = await axios.get(tomlUrl, {
      timeout,
      headers: {
        "User-Agent": "StellarKit-API/1.0",
      },
    });

    // Simple TOML parsing: extract key-value pairs and arrays
    const toml = {};
    const lines = response.data.split("\n");
    let currentSection = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith("#")) continue;

      // Handle section headers [SECTION]
      const sectionMatch = trimmed.match(/^\[(.+)\]$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1].toLowerCase();
        toml[currentSection] = toml[currentSection] || [];
        continue;
      }

      // Handle key-value pairs
      const kvMatch = trimmed.match(/^([a-z_]+)\s*=\s*"(.*)"\s*$/i);
      if (kvMatch) {
        const [, key, value] = kvMatch;
        const lowerKey = key.toLowerCase();

        if (currentSection) {
          // Add to current section array
          if (!Array.isArray(toml[currentSection])) {
            toml[currentSection] = [];
          }
          toml[currentSection].push({ [lowerKey]: value });
        } else {
          // Add to root
          toml[lowerKey] = value;
        }
      }
    }

    return toml;
  } catch (error) {
    // Gracefully return null for any errors (network, timeout, parsing, etc.)
    return null;
  }
}

/**
 * Gets asset metadata from TOML for a specific asset code.
 *
 * @param {string} homeDomain - The issuer's home domain
 * @param {string} assetCode - The asset code to find in TOML
 * @returns {Promise<Object|null>} Asset metadata with name, description, image, or null
 */
async function getAssetMetadataFromToml(homeDomain, assetCode) {
  if (!homeDomain || !assetCode) return null;

  try {
    const toml = await fetchStellarToml(homeDomain);
    if (!toml || !toml.currencies) return null;

    // Find the matching currency in the TOML
    const currencyEntries = toml.currencies;
    if (!Array.isArray(currencyEntries)) return null;

    for (const entry of currencyEntries) {
      if (entry.code === assetCode) {
        return {
          name: entry.name || null,
          description: entry.desc || null,
          image: entry.image || null,
        };
      }
    }

    return null;
  } catch (error) {
    // Gracefully handle any errors
    return null;
  }
}

module.exports = {
  fetchStellarToml,
  getAssetMetadataFromToml,
};
