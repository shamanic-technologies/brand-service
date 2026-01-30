/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Fix the normalize_url function regex issue
    CREATE OR REPLACE FUNCTION normalize_url(p_url TEXT)
    RETURNS TEXT AS $$
    DECLARE
      v_normalized TEXT;
      v_protocol TEXT;
      v_host TEXT;
      v_path TEXT;
    BEGIN
      -- Start with original URL
      v_normalized := p_url;
      
      -- Remove fragment (#section)
      v_normalized := regexp_replace(v_normalized, '#.*$', '');
      
      -- Force https:// (convert http:// to https://)
      v_normalized := regexp_replace(v_normalized, '^http://', 'https://');
      
      -- Remove www. from hostname
      v_normalized := regexp_replace(v_normalized, '^(https?://)www\\.', '\\1');
      
      -- Remove trailing slash (but keep for root path like https://example.com/)
      v_normalized := regexp_replace(v_normalized, '([^/])/+$', '\\1');
      
      -- Remove common marketing query params
      v_normalized := regexp_replace(v_normalized, '[?&](utm_[^&]*)', '', 'g');
      v_normalized := regexp_replace(v_normalized, '[?&](ref=[^&]*)', '', 'g');
      v_normalized := regexp_replace(v_normalized, '[?&](source=[^&]*)', '', 'g');
      v_normalized := regexp_replace(v_normalized, '[?&](fbclid=[^&]*)', '', 'g');
      v_normalized := regexp_replace(v_normalized, '[?&](gclid=[^&]*)', '', 'g');
      v_normalized := regexp_replace(v_normalized, '[?&](msclkid=[^&]*)', '', 'g');
      v_normalized := regexp_replace(v_normalized, '[?&](mc_[^&]*)', '', 'g');
      
      -- Clean up query string separators
      v_normalized := regexp_replace(v_normalized, '\\?&', '?');
      v_normalized := regexp_replace(v_normalized, '&+', '&');
      v_normalized := regexp_replace(v_normalized, '\\?$', '');
      v_normalized := regexp_replace(v_normalized, '&$', '');
      
      -- Lowercase the hostname part only (path is case-sensitive)
      IF v_normalized ~ '^https?://' THEN
        -- Extract components (fixed: no backslash before ? in character class)
        v_protocol := substring(v_normalized from '^https?://');
        v_host := substring(v_normalized from '^https?://([^/?]+)');
        v_path := substring(v_normalized from '^https?://[^/?]+(.*)');
        
        -- Reconstruct with lowercase host
        IF v_path IS NOT NULL AND v_path != '' THEN
          v_normalized := v_protocol || lower(v_host) || v_path;
        ELSE
          v_normalized := v_protocol || lower(v_host);
        END IF;
      END IF;
      
      RETURN v_normalized;
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- No down migration needed, function already exists
  `);
};
