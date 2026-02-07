/**
 * NENA i3 PIDF-LO (Presence Information Data Format - Location Object)
 * XML generator for NG 911 dispatch per NENA standards.
 */

export interface CivicAddress {
  country: string;
  state: string;
  city: string;
  street: string;
  houseNumber: string;
  zip: string;
  floor?: number;
  room?: string;
  building?: string;
}

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
  altitude?: number;
  uncertainty?: number; // meters
}

export interface CallerInfo {
  name?: string;
  phone?: string;
  organizationName?: string;
}

/**
 * Generate a NENA i3 compliant PIDF-LO XML document.
 * Used to transmit location data to 911 PSAPs.
 */
export function generatePidfLo(opts: {
  alertId: string;
  civic: CivicAddress;
  geo: GeoCoordinates;
  caller?: CallerInfo;
  timestamp?: string;
}): string {
  const ts = opts.timestamp || new Date().toISOString();
  const entityUri = `pres:safeschool-alert-${opts.alertId}@safeschool.app`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<presence xmlns="urn:ietf:params:xml:ns:pidf"
          xmlns:gp="urn:ietf:params:xml:ns:pidf:geopriv10"
          xmlns:gml="http://www.opengis.net/gml"
          xmlns:ca="urn:ietf:params:xml:ns:pidf:geopriv10:civicAddr"
          xmlns:dm="urn:ietf:params:xml:ns:pidf:data-model"
          entity="${entityUri}">
  <dm:device id="safeschool-${opts.alertId}">
    <gp:geopriv>
      <gp:location-info>
        <gml:Point srsName="urn:ogc:def:crs:EPSG::4326">
          <gml:pos>${opts.geo.latitude} ${opts.geo.longitude}</gml:pos>
        </gml:Point>
        <ca:civicAddress>
          <ca:country>${escapeXml(opts.civic.country)}</ca:country>
          <ca:A1>${escapeXml(opts.civic.state)}</ca:A1>
          <ca:A3>${escapeXml(opts.civic.city)}</ca:A3>
          <ca:RD>${escapeXml(opts.civic.street)}</ca:RD>
          <ca:HNO>${escapeXml(opts.civic.houseNumber)}</ca:HNO>
          <ca:PC>${escapeXml(opts.civic.zip)}</ca:PC>${opts.civic.floor !== undefined ? `
          <ca:FLR>${opts.civic.floor}</ca:FLR>` : ''}${opts.civic.room ? `
          <ca:NAM>${escapeXml(opts.civic.room)}</ca:NAM>` : ''}${opts.civic.building ? `
          <ca:BLD>${escapeXml(opts.civic.building)}</ca:BLD>` : ''}
        </ca:civicAddress>
      </gp:location-info>
      <gp:usage-rules>
        <gp:retransmission-allowed>yes</gp:retransmission-allowed>
      </gp:usage-rules>
      <gp:method>Manual</gp:method>
    </gp:geopriv>
    <dm:timestamp>${ts}</dm:timestamp>
  </dm:device>
  <tuple id="safeschool-alert">
    <status>
      <basic>open</basic>
    </status>
    <timestamp>${ts}</timestamp>
  </tuple>
</presence>`;
}

/**
 * Parse a street address into civic components.
 */
export function parseAddress(address: string, city: string, state: string, zip: string): CivicAddress {
  // Simple parsing: "123 Lincoln Ave" → houseNumber="123", street="Lincoln Ave"
  const match = address.match(/^(\d+)\s+(.+)$/);
  return {
    country: 'US',
    state,
    city,
    street: match ? match[2] : address,
    houseNumber: match ? match[1] : '',
    zip,
  };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
