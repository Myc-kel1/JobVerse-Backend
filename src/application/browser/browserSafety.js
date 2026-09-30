const dns =
  require("dns").promises;

const net =
  require("net");

/*
 * ============================================================
 * BROWSER SAFETY
 * ============================================================
 *
 * PURPOSE
 * ------------------------------------------------------------
 *
 * JobVerse uses Playwright as a server-side browser to inspect
 * external job-application pages.
 *
 * That introduces an important security boundary:
 *
 * external URLs must NOT be allowed to make the JobVerse
 * backend browser access internal/private infrastructure.
 *
 * This module provides centralized validation for browser
 * destinations.
 *
 * ============================================================
 * WHAT THIS FILE PROTECTS AGAINST
 * ============================================================
 *
 * Examples:
 *
 * - localhost access
 * - private IPv4 networks
 * - private IPv6 networks
 * - cloud metadata endpoints
 * - link-local networks
 * - unsupported protocols
 * - URLs containing embedded credentials
 * - unusual ports unless explicitly allowed
 *
 * ============================================================
 * ARCHITECTURAL RULE
 * ============================================================
 *
 * Browser navigation should NEVER call:
 *
 *     page.goto(userSuppliedUrl)
 *
 * without first passing the destination through this service.
 *
 * Later, browserService.js will also use these checks while
 * intercepting navigation requests.
 *
 * ============================================================
 */

/*
 * ============================================================
 * CONSTANTS
 * ============================================================
 */

const ALLOWED_PROTOCOLS =
  new Set([
    "http:",
    "https:",
  ]);

/*
 * Job application websites overwhelmingly use normal web
 * ports.
 *
 * Extra ports can be allowed through:
 *
 * JOBVERSE_BROWSER_ALLOWED_PORTS=80,443,8080
 *
 * rather than hard-coding exceptions inside application code.
 */
const DEFAULT_ALLOWED_PORTS =
  new Set([
    80,
    443,
  ]);

/*
 * Hostnames that should never be accessed by the backend
 * browser.
 */
const BLOCKED_HOSTNAMES =
  new Set([
    "localhost",
    "localhost.localdomain",

    /*
     * Common cloud metadata hostname.
     */
    "metadata.google.internal",
  ]);

/*
 * Hostname suffixes commonly representing local networks.
 */
const BLOCKED_HOSTNAME_SUFFIXES =
  [
    ".localhost",
    ".local",
    ".internal",
    ".home.arpa",
  ];

/*
 * ============================================================
 * BASIC HELPERS
 * ============================================================
 */

function normalizeString(
  value
) {
  return String(
    value ?? ""
  ).trim();
}

function normalizeLower(
  value
) {
  return normalizeString(
    value
  ).toLowerCase();
}

/*
 * ============================================================
 * CONFIGURED PORTS
 * ============================================================
 */

function getAllowedPorts() {
  const configured =
    normalizeString(
      process.env
        .JOBVERSE_BROWSER_ALLOWED_PORTS
    );

  if (!configured) {
    return new Set(
      DEFAULT_ALLOWED_PORTS
    );
  }

  const ports =
    configured
      .split(",")
      .map(
        (value) =>
          Number(
            value.trim()
          )
      )
      .filter(
        (value) =>
          Number.isInteger(
            value
          ) &&
          value >= 1 &&
          value <= 65535
      );

  /*
   * A malformed environment variable should not accidentally
   * disable all protection.
   */
  if (
    ports.length ===
    0
  ) {
    return new Set(
      DEFAULT_ALLOWED_PORTS
    );
  }

  return new Set(
    ports
  );
}

/*
 * ============================================================
 * PORT VALIDATION
 * ============================================================
 */

function getEffectivePort(
  parsedUrl
) {
  if (
    parsedUrl.port
  ) {
    return Number(
      parsedUrl.port
    );
  }

  if (
    parsedUrl.protocol ===
    "https:"
  ) {
    return 443;
  }

  return 80;
}

function isAllowedPort(
  parsedUrl
) {
  const port =
    getEffectivePort(
      parsedUrl
    );

  return getAllowedPorts()
    .has(
      port
    );
}

/*
 * ============================================================
 * IPv4 HELPERS
 * ============================================================
 */

function ipv4ToInteger(
  address
) {
  const parts =
    address
      .split(".")
      .map(Number);

  if (
    parts.length !==
      4 ||
    parts.some(
      (part) =>
        !Number.isInteger(
          part
        ) ||
        part < 0 ||
        part > 255
    )
  ) {
    return null;
  }

  return (
    (
      (
        (
          (
            parts[0] *
            256
          ) +
          parts[1]
        ) *
        256
      ) +
      parts[2]
    ) *
    256 +
    parts[3]
  );
}

function ipv4InRange(
  address,
  network,
  prefix
) {
  const addressInt =
    ipv4ToInteger(
      address
    );

  const networkInt =
    ipv4ToInteger(
      network
    );

  if (
    addressInt ===
      null ||
    networkInt ===
      null
  ) {
    return false;
  }

  /*
   * JavaScript bitwise operators operate on signed 32-bit
   * values, so using arithmetic division avoids signed integer
   * edge cases.
   */
  const blockSize =
    2 **
    (
      32 -
      prefix
    );

  return (
    Math.floor(
      addressInt /
      blockSize
    ) ===
    Math.floor(
      networkInt /
      blockSize
    )
  );
}

/*
 * ============================================================
 * BLOCKED IPv4 RANGES
 * ============================================================
 *
 * These include:
 *
 * - unspecified
 * - private networks
 * - carrier-grade NAT
 * - loopback
 * - link-local
 * - documentation networks
 * - benchmark networks
 * - multicast
 * - reserved space
 */

const BLOCKED_IPV4_RANGES =
  [
    [
      "0.0.0.0",
      8,
    ],

    [
      "10.0.0.0",
      8,
    ],

    [
      "100.64.0.0",
      10,
    ],

    [
      "127.0.0.0",
      8,
    ],

    [
      "169.254.0.0",
      16,
    ],

    [
      "172.16.0.0",
      12,
    ],

    [
      "192.0.0.0",
      24,
    ],

    [
      "192.0.2.0",
      24,
    ],

    [
      "192.168.0.0",
      16,
    ],

    [
      "198.18.0.0",
      15,
    ],

    [
      "198.51.100.0",
      24,
    ],

    [
      "203.0.113.0",
      24,
    ],

    [
      "224.0.0.0",
      4,
    ],

    [
      "240.0.0.0",
      4,
    ],
  ];

/*
 * ============================================================
 * IPv4 SAFETY CHECK
 * ============================================================
 */

function isBlockedIpv4(
  address
) {
  return BLOCKED_IPV4_RANGES.some(
    (
      [
        network,
        prefix,
      ]
    ) =>
      ipv4InRange(
        address,
        network,
        prefix
      )
  );
}

/*
 * ============================================================
 * IPv6 HELPERS
 * ============================================================
 */

function normalizeIpv6(
  value
) {
  return normalizeLower(
    value
  )
    .replace(
      /^\[|\]$/g,
      ""
    );
}

/*
 * ============================================================
 * IPv4-MAPPED IPv6
 * ============================================================
 *
 * Example:
 *
 * ::ffff:127.0.0.1
 *
 * must still be treated as loopback.
 */

function getMappedIpv4(
  address
) {
  const normalized =
    normalizeIpv6(
      address
    );

  const match =
    normalized.match(
      /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/
    );

  return match
    ? match[1]
    : null;
}

/*
 * ============================================================
 * IPv6 SAFETY CHECK
 * ============================================================
 */

function isBlockedIpv6(
  address
) {
  const normalized =
    normalizeIpv6(
      address
    );

  /*
   * Unspecified address.
   */
  if (
    normalized ===
    "::"
  ) {
    return true;
  }

  /*
   * Loopback.
   */
  if (
    normalized ===
    "::1"
  ) {
    return true;
  }

  /*
   * IPv4-mapped IPv6.
   */
  const mappedIpv4 =
    getMappedIpv4(
      normalized
    );

  if (
    mappedIpv4
  ) {
    return isBlockedIpv4(
      mappedIpv4
    );
  }

  /*
   * Unique-local:
   *
   * fc00::/7
   */
  if (
    normalized.startsWith(
      "fc"
    ) ||
    normalized.startsWith(
      "fd"
    )
  ) {
    return true;
  }

  /*
   * Link-local:
   *
   * fe80::/10
   *
   * Covers:
   *
   * fe8*
   * fe9*
   * fea*
   * feb*
   */
  if (
    /^fe[89ab]/i.test(
      normalized
    )
  ) {
    return true;
  }

  /*
   * IPv6 documentation range.
   *
   * 2001:db8::/32
   */
  if (
    normalized.startsWith(
      "2001:db8:"
    )
  ) {
    return true;
  }

  /*
   * Multicast:
   *
   * ff00::/8
   */
  if (
    normalized.startsWith(
      "ff"
    )
  ) {
    return true;
  }

  return false;
}

/*
 * ============================================================
 * IP ADDRESS SAFETY
 * ============================================================
 */

function isBlockedIpAddress(
  address
) {
  const version =
    net.isIP(
      normalizeString(
        address
      )
    );

  if (
    version ===
    4
  ) {
    return isBlockedIpv4(
      address
    );
  }

  if (
    version ===
    6
  ) {
    return isBlockedIpv6(
      address
    );
  }

  /*
   * Invalid IP input should not be treated as a valid public
   * destination.
   */
  return true;
}

/*
 * ============================================================
 * HOSTNAME SAFETY
 * ============================================================
 */

function isBlockedHostname(
  hostname
) {
  const normalized =
    normalizeLower(
      hostname
    )
      .replace(
        /\.$/,
        ""
      );

  if (!normalized) {
    return true;
  }

  if (
    BLOCKED_HOSTNAMES.has(
      normalized
    )
  ) {
    return true;
  }

  if (
    BLOCKED_HOSTNAME_SUFFIXES.some(
      (suffix) =>
        normalized.endsWith(
          suffix
        )
    )
  ) {
    return true;
  }

  /*
   * If hostname itself is an IP address, validate it directly.
   */
  if (
    net.isIP(
      normalized
    )
  ) {
    return isBlockedIpAddress(
      normalized
    );
  }

  return false;
}

/*
 * ============================================================
 * DNS RESOLUTION
 * ============================================================
 *
 * A hostname may look public while resolving to:
 *
 * 127.0.0.1
 * 10.x.x.x
 * 169.254.x.x
 *
 * so hostname validation alone is insufficient.
 */

async function resolveHostname(
  hostname
) {
  const normalized =
    normalizeLower(
      hostname
    );

  /*
   * Literal IP addresses do not require DNS.
   */
  if (
    net.isIP(
      normalized
    )
  ) {
    return [
      {
        address:
          normalized,

        family:
          net.isIP(
            normalized
          ),
      },
    ];
  }

  let records;

  try {
    records =
      await dns.lookup(
        normalized,
        {
          all:
            true,

          verbatim:
            true,
        }
      );
  } catch (err) {
    throw new Error(
      `Unable to resolve browser destination hostname: ${normalized}`
    );
  }

  if (
    !Array.isArray(
      records
    ) ||
    records.length ===
      0
  ) {
    throw new Error(
      `Browser destination hostname did not resolve: ${normalized}`
    );
  }

  return records;
}

/*
 * ============================================================
 * VALIDATE DNS DESTINATIONS
 * ============================================================
 */

async function assertPublicHostname(
  hostname
) {
  const normalized =
    normalizeLower(
      hostname
    );

  if (
    isBlockedHostname(
      normalized
    )
  ) {
    throw new Error(
      `Blocked browser destination hostname: ${normalized}`
    );
  }

  const records =
    await resolveHostname(
      normalized
    );

  for (
    const record of
    records
  ) {
    if (
      isBlockedIpAddress(
        record.address
      )
    ) {
      throw new Error(
        `Browser destination resolves to a blocked network address: ${record.address}`
      );
    }
  }

  return records;
}

/*
 * ============================================================
 * PARSE URL
 * ============================================================
 */

function parseExternalUrl(
  value
) {
  const raw =
    normalizeString(
      value
    );

  if (!raw) {
    throw new Error(
      "Browser destination URL is required"
    );
  }

  let parsed;

  try {
    parsed =
      new URL(
        raw
      );
  } catch (_) {
    throw new Error(
      "Invalid browser destination URL"
    );
  }

  return parsed;
}

/*
 * ============================================================
 * ASSERT SAFE EXTERNAL URL
 * ============================================================
 *
 * This is the main public safety function.
 */

async function assertSafeExternalUrl(
  value
) {
  const parsed =
    parseExternalUrl(
      value
    );

  /*
   * ----------------------------------------------------------
   * PROTOCOL
   * ----------------------------------------------------------
   */

  if (
    !ALLOWED_PROTOCOLS.has(
      parsed.protocol
    )
  ) {
    throw new Error(
      `Unsupported browser URL protocol: ${parsed.protocol}`
    );
  }

  /*
   * ----------------------------------------------------------
   * EMBEDDED CREDENTIALS
   * ----------------------------------------------------------
   *
   * URLs such as:
   *
   * https://username:password@example.com/
   *
   * are not accepted.
   */

  if (
    parsed.username ||
    parsed.password
  ) {
    throw new Error(
      "Browser destination URLs must not contain embedded credentials"
    );
  }

  /*
   * ----------------------------------------------------------
   * PORT
   * ----------------------------------------------------------
   */

  if (
    !isAllowedPort(
      parsed
    )
  ) {
    throw new Error(
      `Browser destination port ${getEffectivePort(
        parsed
      )} is not allowed`
    );
  }

  /*
   * ----------------------------------------------------------
   * HOSTNAME + DNS
   * ----------------------------------------------------------
   */

  const resolvedAddresses =
    await assertPublicHostname(
      parsed.hostname
    );

  /*
   * Strip fragment identifiers.
   *
   * They are browser-local and unnecessary for network safety.
   */
  parsed.hash =
    "";

  return {
    url:
      parsed.toString(),

    protocol:
      parsed.protocol,

    hostname:
      parsed.hostname,

    port:
      getEffectivePort(
        parsed
      ),

    resolvedAddresses:
      resolvedAddresses.map(
        (record) => ({
          address:
            record.address,

          family:
            record.family,
        })
      ),
  };
}

/*
 * ============================================================
 * SAFE BOOLEAN CHECK
 * ============================================================
 *
 * Convenience wrapper for callers that only need yes/no.
 */

async function isSafeExternalUrl(
  value
) {
  try {
    await assertSafeExternalUrl(
      value
    );

    return true;
  } catch (_) {
    return false;
  }
}

/*
 * ============================================================
 * HOST SAFETY CACHE
 * ============================================================
 *
 * Browser pages frequently load many resources from the same
 * hosts.
 *
 * Resolving DNS repeatedly for every request would add
 * unnecessary latency.
 *
 * browserService.js can use this cache during one browser
 * session.
 */

function createHostSafetyCache() {
  const cache =
    new Map();

  return {
    async check(
      hostname
    ) {
      const normalized =
        normalizeLower(
          hostname
        );

      if (
        cache.has(
          normalized
        )
      ) {
        return cache.get(
          normalized
        );
      }

      const promise =
        assertPublicHostname(
          normalized
        );

      /*
       * Store the promise itself so concurrent requests for the
       * same host share one DNS lookup.
       */
      cache.set(
        normalized,
        promise
      );

      try {
        return await promise;
      } catch (err) {
        /*
         * Failed lookups should not be permanently cached so a
         * temporary DNS problem can recover.
         */
        cache.delete(
          normalized
        );

        throw err;
      }
    },

    clear() {
      cache.clear();
    },

    get size() {
      return cache.size;
    },
  };
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  /*
   * Main URL validation.
   */
  assertSafeExternalUrl,
  isSafeExternalUrl,

  /*
   * Host validation.
   */
  assertPublicHostname,
  isBlockedHostname,
  resolveHostname,

  /*
   * IP validation.
   */
  isBlockedIpAddress,
  isBlockedIpv4,
  isBlockedIpv6,

  /*
   * URL helpers.
   */
  parseExternalUrl,
  getEffectivePort,
  isAllowedPort,

  /*
   * Browser-session optimization.
   */
  createHostSafetyCache,

  /*
   * Constants useful for tests.
   */
  ALLOWED_PROTOCOLS,
  DEFAULT_ALLOWED_PORTS,
  BLOCKED_IPV4_RANGES,
};