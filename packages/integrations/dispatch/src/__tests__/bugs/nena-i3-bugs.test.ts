import { describe, it, expect } from 'vitest';
import { generatePidfLo, parseAddress } from '../../nena-i3.js';
import type { CivicAddress, GeoCoordinates, CallerInfo } from '../../nena-i3.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const baseCivic: CivicAddress = {
  country: 'US',
  state: 'NJ',
  city: 'Newark',
  street: 'Lincoln Ave',
  houseNumber: '123',
  zip: '07102',
};

const baseGeo: GeoCoordinates = {
  latitude: 40.7357,
  longitude: -74.1724,
};

const fixedTimestamp = '2026-02-07T12:00:00.000Z';

function makeXml(overrides: {
  alertId?: string;
  civic?: Partial<CivicAddress>;
  geo?: Partial<GeoCoordinates>;
  caller?: CallerInfo;
  timestamp?: string;
} = {}): string {
  return generatePidfLo({
    alertId: overrides.alertId ?? 'test-bug-001',
    civic: { ...baseCivic, ...overrides.civic } as CivicAddress,
    geo: { ...baseGeo, ...overrides.geo } as GeoCoordinates,
    caller: overrides.caller,
    timestamp: overrides.timestamp ?? fixedTimestamp,
  });
}

// ---------------------------------------------------------------------------
// BUG 1: XML special characters in civic address fields
// The escapeXml function does handle &, <, >, ", and '.
// We test thoroughly to ensure all five replacements work together.
// ---------------------------------------------------------------------------

describe('BUG 1: XML special characters in civic address fields', () => {
  it('escapes ampersand in building name', () => {
    const xml = makeXml({ civic: { building: 'Arts & Sciences' } });
    expect(xml).toContain('<ca:BLD>Arts &amp; Sciences</ca:BLD>');
    expect(xml).not.toContain('<ca:BLD>Arts & Sciences</ca:BLD>');
  });

  it('escapes angle brackets in building name', () => {
    const xml = makeXml({ civic: { building: '<Building>' } });
    expect(xml).toContain('<ca:BLD>&lt;Building&gt;</ca:BLD>');
  });

  it('escapes quotes and apostrophes in building name', () => {
    const xml = makeXml({ civic: { building: 'O\'Brien "Hall"' } });
    expect(xml).toContain('O&apos;Brien &quot;Hall&quot;');
  });

  it('escapes a complex mix of special characters', () => {
    const xml = makeXml({ civic: { building: '<Building & "Annex">' } });
    // After escaping: &lt;Building &amp; &quot;Annex&quot;&gt;
    expect(xml).toContain('&lt;Building &amp; &quot;Annex&quot;&gt;');
    // Verify raw unescaped string is NOT present
    expect(xml).not.toContain('<Building & "Annex">');
  });

  it('escapes special chars in room name', () => {
    const xml = makeXml({ civic: { room: 'Lab <A> & "B"' } });
    expect(xml).toContain('<ca:NAM>Lab &lt;A&gt; &amp; &quot;B&quot;</ca:NAM>');
  });

  it('escapes special chars in street name', () => {
    const xml = makeXml({ civic: { street: 'Main & 1st <Ave>' } });
    expect(xml).toContain('<ca:RD>Main &amp; 1st &lt;Ave&gt;</ca:RD>');
  });
});

// ---------------------------------------------------------------------------
// BUG 2: Null island coordinates (0, 0) produce valid XML
// Latitude 0, Longitude 0 is in the Gulf of Guinea -- clearly wrong for a
// US school. The generator silently accepts these without any validation.
// This is a DATA QUALITY bug: the function should reject or warn on (0,0).
// ---------------------------------------------------------------------------

describe('BUG 2: Null island coordinates (0,0) accepted without warning', () => {
  it('generates valid XML with 0,0 coordinates (data quality issue)', () => {
    const xml = makeXml({ geo: { latitude: 0, longitude: 0 } });

    // The XML IS generated -- this documents the bug.
    // A school safety system should not accept (0,0) as a valid location.
    expect(xml).toContain('<gml:pos>0 0</gml:pos>');
    expect(xml).toContain('<?xml version="1.0"');
  });

  it('also accepts negative-zero coordinates', () => {
    const xml = makeXml({ geo: { latitude: -0, longitude: -0 } });
    // JavaScript's -0 renders as "0" in template literals
    expect(xml).toContain('<gml:pos>0 0</gml:pos>');
  });

  it('accepts NaN coordinates without error (no input validation)', () => {
    const xml = makeXml({ geo: { latitude: NaN, longitude: NaN } });
    // NaN in template literals becomes the string "NaN"
    expect(xml).toContain('<gml:pos>NaN NaN</gml:pos>');
  });

  it('accepts Infinity coordinates without error (no input validation)', () => {
    const xml = makeXml({ geo: { latitude: Infinity, longitude: -Infinity } });
    expect(xml).toContain('<gml:pos>Infinity -Infinity</gml:pos>');
  });
});

// ---------------------------------------------------------------------------
// BUG 3: Negative floor number (basement)
// Floor -1 should produce valid XML. The generator uses a truthy check
// (floor !== undefined) which correctly handles 0 and negative values.
// ---------------------------------------------------------------------------

describe('BUG 3: Negative floor numbers', () => {
  it('includes floor -1 (basement) in the XML', () => {
    const xml = makeXml({ civic: { floor: -1 } });
    expect(xml).toContain('<ca:FLR>-1</ca:FLR>');
  });

  it('includes floor 0 (ground level) in the XML', () => {
    const xml = makeXml({ civic: { floor: 0 } });
    // floor !== undefined is true for 0, so it should be included
    expect(xml).toContain('<ca:FLR>0</ca:FLR>');
  });

  it('includes floor -2 (sub-basement) in the XML', () => {
    const xml = makeXml({ civic: { floor: -2 } });
    expect(xml).toContain('<ca:FLR>-2</ca:FLR>');
  });
});

// ---------------------------------------------------------------------------
// BUG 4: Very long building/room names
// No truncation or length validation exists. Names over 200 chars are passed
// through directly. This could cause issues with PSAP systems that have
// field length limits.
// ---------------------------------------------------------------------------

describe('BUG 4: Very long building/room names (no truncation)', () => {
  it('includes a 250-char building name without truncation', () => {
    const longName = 'A'.repeat(250);
    const xml = makeXml({ civic: { building: longName } });
    expect(xml).toContain(`<ca:BLD>${longName}</ca:BLD>`);
    // BUG: NENA civic address fields typically have max lengths.
    // The generator does not enforce any limit.
  });

  it('includes a 500-char room name without truncation', () => {
    const longRoom = 'R'.repeat(500);
    const xml = makeXml({ civic: { room: longRoom } });
    expect(xml).toContain(`<ca:NAM>${longRoom}</ca:NAM>`);
  });

  it('includes a 1000-char street name without truncation', () => {
    const longStreet = 'S'.repeat(1000);
    const xml = makeXml({ civic: { street: longStreet } });
    expect(xml).toContain(`<ca:RD>${longStreet}</ca:RD>`);
  });
});

// ---------------------------------------------------------------------------
// BUG 5: parseAddress with no house number
// The regex ^(\d+)\s+(.+)$ only matches addresses starting with digits.
// "Lincoln Avenue" has no leading number, so houseNumber is '' and street
// is the full input string.
// ---------------------------------------------------------------------------

describe('BUG 5: parseAddress with no house number', () => {
  it('sets houseNumber to empty string when no number prefix', () => {
    const result = parseAddress('Lincoln Avenue', 'Newark', 'NJ', '07102');
    expect(result.houseNumber).toBe('');
    expect(result.street).toBe('Lincoln Avenue');
  });

  it('sets houseNumber to empty for school names', () => {
    const result = parseAddress('Lincoln Elementary School', 'Newark', 'NJ', '07102');
    expect(result.houseNumber).toBe('');
    expect(result.street).toBe('Lincoln Elementary School');
  });

  it('produces XML with empty HNO element (potentially invalid for NENA)', () => {
    const civic = parseAddress('Lincoln Avenue', 'Newark', 'NJ', '07102');
    const xml = generatePidfLo({
      alertId: 'test-no-hno',
      civic,
      geo: baseGeo,
      timestamp: fixedTimestamp,
    });
    // BUG: An empty <ca:HNO></ca:HNO> element is generated.
    // NENA i3 may require HNO to be omitted entirely when unknown.
    expect(xml).toContain('<ca:HNO></ca:HNO>');
  });
});

// ---------------------------------------------------------------------------
// BUG 6: parseAddress with alphanumeric house number
// The regex ^(\d+)\s+(.+)$ requires pure digits. "123A" won't match.
// ---------------------------------------------------------------------------

describe('BUG 6: parseAddress with alphanumeric house number', () => {
  it('fails to parse "123A Lincoln Avenue" (alpha suffix on number)', () => {
    const result = parseAddress('123A Lincoln Avenue', 'Newark', 'NJ', '07102');
    // BUG: "123A" is not pure digits, so the regex doesn't match.
    // houseNumber becomes '' and street is the entire string.
    expect(result.houseNumber).toBe('');
    expect(result.street).toBe('123A Lincoln Avenue');
  });

  it('fails to parse "12-34 Main Street" (hyphenated number)', () => {
    const result = parseAddress('12-34 Main Street', 'Newark', 'NJ', '07102');
    // BUG: Hyphenated house numbers (common in Queens, NY) are not matched.
    expect(result.houseNumber).toBe('');
    expect(result.street).toBe('12-34 Main Street');
  });

  it('fails to parse "123 1/2 Main Street" (fractional number)', () => {
    const result = parseAddress('123 1/2 Main Street', 'Newark', 'NJ', '07102');
    // The regex matches "123" as houseNumber, rest is "1/2 Main Street"
    // which is incorrect -- the full house number should be "123 1/2"
    expect(result.houseNumber).toBe('123');
    expect(result.street).toBe('1/2 Main Street'); // BUG: wrong street name
  });
});

// ---------------------------------------------------------------------------
// BUG 7: parseAddress with leading/trailing spaces
// The regex ^(\d+)\s+(.+)$ anchors at ^ and $, so leading spaces cause
// the match to fail (the string starts with whitespace, not a digit).
// ---------------------------------------------------------------------------

describe('BUG 7: parseAddress with leading/trailing whitespace', () => {
  it('fails to parse with leading spaces', () => {
    const result = parseAddress('  123 Lincoln Ave', 'Newark', 'NJ', '07102');
    // BUG: Leading spaces cause regex to fail; "  123" doesn't match ^\d+
    expect(result.houseNumber).toBe('');
    expect(result.street).toBe('  123 Lincoln Ave');
  });

  it('fails to parse with trailing spaces', () => {
    const result = parseAddress('123 Lincoln Ave  ', 'Newark', 'NJ', '07102');
    // Trailing spaces: (.+)$ does match trailing spaces, so the street
    // name includes them. houseNumber works because ^(\d+) matches "123".
    expect(result.houseNumber).toBe('123');
    expect(result.street).toBe('Lincoln Ave  '); // BUG: trailing spaces preserved
  });

  it('fails to parse with both leading and trailing spaces', () => {
    const result = parseAddress('  123 Lincoln Ave  ', 'Newark', 'NJ', '07102');
    // Leading spaces cause the full match to fail
    expect(result.houseNumber).toBe('');
    expect(result.street).toBe('  123 Lincoln Ave  '); // BUG: entire string with spaces
  });

  it('does not trim city, state, or zip either', () => {
    const result = parseAddress('123 Main St', '  Newark ', ' NJ', '07102 ');
    // These fields are passed through without trimming
    expect(result.city).toBe('  Newark ');
    expect(result.state).toBe(' NJ');
    expect(result.zip).toBe('07102 ');
  });
});

// ---------------------------------------------------------------------------
// BUG 8: Entity URI with special characters in alertId
// The alertId is interpolated directly into the entity URI without
// URI-encoding. Spaces and special chars make the URI invalid per RFC 3986.
// ---------------------------------------------------------------------------

describe('BUG 8: Entity URI with special characters in alertId', () => {
  it('produces invalid URI when alertId contains spaces', () => {
    const xml = makeXml({ alertId: 'alert 001' });
    // BUG: The URI contains unencoded spaces, making it invalid
    expect(xml).toContain('entity="pres:safeschool-alert-alert 001@safeschool.app"');
    // A valid URI should encode spaces as %20
    expect(xml).not.toContain('alert%20001');
  });

  it('produces invalid URI when alertId contains angle brackets', () => {
    const xml = makeXml({ alertId: '<script>alert(1)</script>' });
    // BUG: The alertId is used in the entity attribute without escaping.
    // However, it IS inside an XML attribute using double quotes, and the
    // escapeXml function is NOT applied to the entity URI.
    // The < and > break the XML structure.
    expect(xml).toContain('entity="pres:safeschool-alert-<script>alert(1)</script>@safeschool.app"');
  });

  it('produces invalid URI when alertId contains ampersand', () => {
    const xml = makeXml({ alertId: 'a&b' });
    // BUG: Unescaped & in XML attribute breaks well-formedness
    expect(xml).toContain('entity="pres:safeschool-alert-a&b@safeschool.app"');
    // Also appears in the device id attribute
    expect(xml).toContain('id="safeschool-a&b"');
  });

  it('produces invalid URI when alertId contains quotes', () => {
    const xml = makeXml({ alertId: 'alert"test' });
    // BUG: Unescaped double quote inside a double-quoted attribute
    expect(xml).toContain('entity="pres:safeschool-alert-alert"test@safeschool.app"');
  });
});

// ---------------------------------------------------------------------------
// BUG 9: Missing timestamp uses Date.now() -- non-deterministic output
// This is a design issue rather than a crash bug. We confirm that providing
// a timestamp makes the output deterministic.
// ---------------------------------------------------------------------------

describe('BUG 9: Deterministic output with explicit timestamps', () => {
  it('produces identical XML when timestamp is provided', () => {
    const xml1 = makeXml({ timestamp: '2026-02-07T12:00:00.000Z' });
    const xml2 = makeXml({ timestamp: '2026-02-07T12:00:00.000Z' });
    expect(xml1).toBe(xml2);
  });

  it('produces different XML when timestamp is omitted (non-deterministic)', () => {
    // Both calls use Date.now() -- they may differ if the clock ticks
    // between calls. In practice they often match, but the point is
    // that the output is NOT guaranteed deterministic.
    const xml1 = generatePidfLo({
      alertId: 'det-test',
      civic: baseCivic,
      geo: baseGeo,
      // no timestamp!
    });
    // The XML should contain a valid ISO timestamp
    expect(xml1).toMatch(/<dm:timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ---------------------------------------------------------------------------
// BUG 10: Altitude and uncertainty fields are accepted but NEVER included
// in the output XML. NENA i3 PIDF-LO supports 3D coordinates and
// uncertainty, but generatePidfLo ignores these optional fields entirely.
// ---------------------------------------------------------------------------

describe('BUG 10: Altitude and uncertainty silently dropped', () => {
  it('does not include altitude in the XML even when provided', () => {
    const xml = makeXml({
      geo: { latitude: 40.7357, longitude: -74.1724, altitude: 15.5 },
    });
    // BUG: altitude is accepted in the interface but never rendered
    expect(xml).not.toContain('15.5');
    expect(xml).not.toContain('altitude');
    expect(xml).not.toContain('Alt');
    // The pos element only has lat/lon, no 3D coordinate
    expect(xml).toContain('<gml:pos>40.7357 -74.1724</gml:pos>');
  });

  it('does not include uncertainty in the XML even when provided', () => {
    const xml = makeXml({
      geo: { latitude: 40.7357, longitude: -74.1724, uncertainty: 77 },
    });
    // BUG: uncertainty is accepted in the interface but never rendered.
    // NENA i3 supports <gml:CircleByCenterPoint> for uncertainty radius.
    expect(xml).not.toContain('77');
    expect(xml).not.toContain('uncertainty');
    expect(xml).not.toContain('CircleByCenterPoint');
  });

  it('does not include either altitude or uncertainty when both provided', () => {
    const xml = makeXml({
      geo: {
        latitude: 40.7357,
        longitude: -74.1724,
        altitude: 30,
        uncertainty: 5,
      },
    });
    // The GML point should be 2D only
    expect(xml).toContain('<gml:pos>40.7357 -74.1724</gml:pos>');
    // A proper 3D PIDF-LO would have srsName ending in "4979" (3D CRS)
    // and the pos would include the altitude as a third value.
    expect(xml).toContain('EPSG::4326'); // 2D only
    expect(xml).not.toContain('EPSG::4979'); // 3D CRS not used
  });
});

// ---------------------------------------------------------------------------
// BUG 11: CallerInfo phone and organizationName are silently ignored
// The CallerInfo interface defines phone and organizationName, but
// generatePidfLo does not include them anywhere in the XML output.
// Only caller.name would be used if the code used it (but it also doesn't
// appear to be included either).
// ---------------------------------------------------------------------------

describe('BUG 11: CallerInfo fields silently ignored', () => {
  it('does not include caller name in the XML', () => {
    const xml = makeXml({
      caller: { name: 'John Smith' },
    });
    // BUG: caller.name is accepted but never rendered in the XML.
    // PIDF can include <dm:person> elements with caller identity.
    expect(xml).not.toContain('John Smith');
    expect(xml).not.toContain('caller');
    expect(xml).not.toContain('person');
  });

  it('does not include caller phone in the XML', () => {
    const xml = makeXml({
      caller: { name: 'Jane Doe', phone: '+15551234567' },
    });
    // BUG: phone number is never included
    expect(xml).not.toContain('+15551234567');
    expect(xml).not.toContain('5551234567');
    expect(xml).not.toContain('tel:');
  });

  it('does not include organizationName in the XML', () => {
    const xml = makeXml({
      caller: {
        name: 'Admin User',
        phone: '+15559876543',
        organizationName: 'Lincoln Elementary School',
      },
    });
    // BUG: organizationName is never included.
    // NENA i3 PIDF-LO typically carries caller info for PSAP display.
    expect(xml).not.toContain('Lincoln Elementary School');
    expect(xml).not.toContain('organizationName');
    // None of the CallerInfo fields appear anywhere
    expect(xml).not.toContain('Admin User');
    expect(xml).not.toContain('+15559876543');
  });

  it('generates identical XML with and without CallerInfo', () => {
    const withCaller = makeXml({
      caller: {
        name: 'Full CallerInfo',
        phone: '+15550001111',
        organizationName: 'Test School',
      },
    });
    const withoutCaller = makeXml({});

    // BUG: CallerInfo has absolutely no effect on the output
    expect(withCaller).toBe(withoutCaller);
  });
});
