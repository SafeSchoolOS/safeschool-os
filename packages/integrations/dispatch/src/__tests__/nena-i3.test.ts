import { describe, it, expect } from 'vitest';
import { generatePidfLo, parseAddress } from '../nena-i3.js';
import type { CivicAddress, GeoCoordinates, CallerInfo } from '../nena-i3.js';

// ---------------------------------------------------------------------------
// Tests: generatePidfLo
// ---------------------------------------------------------------------------

describe('generatePidfLo', () => {
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

  it('generates valid PIDF-LO XML', () => {
    const xml = generatePidfLo({
      alertId: 'test-001',
      civic: baseCivic,
      geo: baseGeo,
    });

    // XML declaration
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');

    // PIDF namespace
    expect(xml).toContain('xmlns="urn:ietf:params:xml:ns:pidf"');
    expect(xml).toContain('xmlns:gp="urn:ietf:params:xml:ns:pidf:geopriv10"');
    expect(xml).toContain('xmlns:gml="http://www.opengis.net/gml"');
    expect(xml).toContain('xmlns:ca="urn:ietf:params:xml:ns:pidf:geopriv10:civicAddr"');
    expect(xml).toContain('xmlns:dm="urn:ietf:params:xml:ns:pidf:data-model"');
  });

  it('includes entity URI with alert ID', () => {
    const xml = generatePidfLo({
      alertId: 'alert-xyz',
      civic: baseCivic,
      geo: baseGeo,
    });

    expect(xml).toContain('entity="pres:safeschool-alert-alert-xyz@safeschool.app"');
  });

  it('includes GML coordinates', () => {
    const xml = generatePidfLo({
      alertId: 'test-geo',
      civic: baseCivic,
      geo: { latitude: 40.1234, longitude: -74.5678 },
    });

    expect(xml).toContain('srsName="urn:ogc:def:crs:EPSG::4326"');
    expect(xml).toContain('<gml:pos>40.1234 -74.5678</gml:pos>');
  });

  it('includes civic address fields', () => {
    const xml = generatePidfLo({
      alertId: 'test-civic',
      civic: baseCivic,
      geo: baseGeo,
    });

    expect(xml).toContain('<ca:country>US</ca:country>');
    expect(xml).toContain('<ca:A1>NJ</ca:A1>');
    expect(xml).toContain('<ca:A3>Newark</ca:A3>');
    expect(xml).toContain('<ca:RD>Lincoln Ave</ca:RD>');
    expect(xml).toContain('<ca:HNO>123</ca:HNO>');
    expect(xml).toContain('<ca:PC>07102</ca:PC>');
  });

  it('includes optional floor when provided', () => {
    const civic: CivicAddress = { ...baseCivic, floor: 2 };
    const xml = generatePidfLo({
      alertId: 'test-floor',
      civic,
      geo: baseGeo,
    });

    expect(xml).toContain('<ca:FLR>2</ca:FLR>');
  });

  it('omits floor when not provided', () => {
    const xml = generatePidfLo({
      alertId: 'test-no-floor',
      civic: baseCivic,
      geo: baseGeo,
    });

    expect(xml).not.toContain('<ca:FLR>');
  });

  it('includes optional room when provided', () => {
    const civic: CivicAddress = { ...baseCivic, room: 'Room 101' };
    const xml = generatePidfLo({
      alertId: 'test-room',
      civic,
      geo: baseGeo,
    });

    expect(xml).toContain('<ca:NAM>Room 101</ca:NAM>');
  });

  it('includes optional building when provided', () => {
    const civic: CivicAddress = { ...baseCivic, building: 'Science Wing' };
    const xml = generatePidfLo({
      alertId: 'test-bld',
      civic,
      geo: baseGeo,
    });

    expect(xml).toContain('<ca:BLD>Science Wing</ca:BLD>');
  });

  it('escapes XML special characters', () => {
    const civic: CivicAddress = {
      ...baseCivic,
      street: 'Main & Elm <Street>',
      building: 'O\'Brien "Hall"',
    };
    const xml = generatePidfLo({
      alertId: 'test-escape',
      civic,
      geo: baseGeo,
    });

    expect(xml).toContain('Main &amp; Elm &lt;Street&gt;');
    expect(xml).toContain('O&apos;Brien &quot;Hall&quot;');
  });

  it('uses provided timestamp', () => {
    const ts = '2026-02-07T12:00:00.000Z';
    const xml = generatePidfLo({
      alertId: 'test-ts',
      civic: baseCivic,
      geo: baseGeo,
      timestamp: ts,
    });

    expect(xml).toContain(`<dm:timestamp>${ts}</dm:timestamp>`);
    expect(xml).toContain(`<timestamp>${ts}</timestamp>`);
  });

  it('generates a timestamp if not provided', () => {
    const xml = generatePidfLo({
      alertId: 'test-auto-ts',
      civic: baseCivic,
      geo: baseGeo,
    });

    // Should contain an ISO timestamp
    expect(xml).toMatch(/<dm:timestamp>\d{4}-\d{2}-\d{2}T/);
  });

  it('includes geopriv usage rules', () => {
    const xml = generatePidfLo({
      alertId: 'test-rules',
      civic: baseCivic,
      geo: baseGeo,
    });

    expect(xml).toContain('<gp:retransmission-allowed>yes</gp:retransmission-allowed>');
    expect(xml).toContain('<gp:method>Manual</gp:method>');
  });

  it('includes tuple with open status', () => {
    const xml = generatePidfLo({
      alertId: 'test-tuple',
      civic: baseCivic,
      geo: baseGeo,
    });

    expect(xml).toContain('<tuple id="safeschool-alert">');
    expect(xml).toContain('<basic>open</basic>');
  });
});

// ---------------------------------------------------------------------------
// Tests: parseAddress
// ---------------------------------------------------------------------------

describe('parseAddress', () => {
  it('parses a standard street address', () => {
    const result = parseAddress('123 Lincoln Ave', 'Newark', 'NJ', '07102');

    expect(result.country).toBe('US');
    expect(result.state).toBe('NJ');
    expect(result.city).toBe('Newark');
    expect(result.houseNumber).toBe('123');
    expect(result.street).toBe('Lincoln Ave');
    expect(result.zip).toBe('07102');
  });

  it('parses multi-word street names', () => {
    const result = parseAddress('456 Martin Luther King Jr Blvd', 'Newark', 'NJ', '07102');

    expect(result.houseNumber).toBe('456');
    expect(result.street).toBe('Martin Luther King Jr Blvd');
  });

  it('handles address without house number', () => {
    const result = parseAddress('Lincoln Elementary School', 'Newark', 'NJ', '07102');

    // No leading number — entire string becomes street, houseNumber empty
    expect(result.houseNumber).toBe('');
    expect(result.street).toBe('Lincoln Elementary School');
  });

  it('always sets country to US', () => {
    const result = parseAddress('1 Main St', 'Anytown', 'CA', '90210');
    expect(result.country).toBe('US');
  });

  it('preserves all passed-through fields', () => {
    const result = parseAddress('789 Oak Dr', 'Springfield', 'IL', '62701');

    expect(result.city).toBe('Springfield');
    expect(result.state).toBe('IL');
    expect(result.zip).toBe('62701');
  });
});
