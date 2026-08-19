export async function ensureSchema(db) {
  // Check if sites table exists
  try {
    await db.prepare("SELECT id FROM sites LIMIT 1").first();
    // Table exists, schema is already initialized
    return;
  } catch (e) {
    // If table doesn't exist, initialize schema
    console.log("Database schema not found. Initializing database schema...");
  }

  // Define SQL statements separately to avoid D1 exec split issues
  const statements = [
    `CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      address TEXT,
      city TEXT,
      province_state TEXT,
      country TEXT,
      acreage REAL,
      current_use TEXT,
      existing_infra TEXT,
      existing_electrical_infra TEXT,
      ownership_status TEXT,
      opportunity_type TEXT,
      target_size_mw REAL,
      project_types TEXT,
      created_at TEXT,
      internal_notes TEXT DEFAULT '',
      lead_status TEXT DEFAULT 'New',
      is_confidential INTEGER DEFAULT 0
    )`,

    `CREATE TABLE IF NOT EXISTS power_info (
      site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
      existing_capacity_mw REAL,
      firm_power_available_mw REAL,
      additional_power_mw REAL,
      max_potential_capacity_mw REAL,
      power_type TEXT,
      utility_provider TEXT,
      grid_status TEXT,
      substation_on_near_site TEXT,
      transmission_infra TEXT,
      voltage_kv TEXT,
      time_to_capacity TEXT,
      delivered_cost_mwh REAL,
      generation_source TEXT,
      renewable_pct REAL,
      has_ppa TEXT,
      ppa_remaining_term TEXT,
      demand_restrictions TEXT,
      other_constraints TEXT
    )`,

    `CREATE TABLE IF NOT EXISTS connectivity_info (
      site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
      fibre_available TEXT,
      fibre_providers TEXT,
      diverse_routes TEXT,
      distance_to_fibre TEXT,
      telecom_infra TEXT,
      latency_limitations TEXT
    )`,

    `CREATE TABLE IF NOT EXISTS development_info (
      site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
      zoning TEXT,
      data_centre_permitted TEXT,
      permitting_complexity TEXT,
      environmental_approvals TEXT,
      environmental_restrictions TEXT,
      flood_exposure TEXT,
      wildfire_exposure TEXT,
      seismic_exposure TEXT,
      other_natural_hazards TEXT,
      site_access_roads TEXT,
      proximity_airport_port TEXT,
      construction_logistics_constraints TEXT
    )`,

    `CREATE TABLE IF NOT EXISTS water_infrastructure_info (
      site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
      water_availability TEXT,
      municipal_water TEXT,
      industrial_water TEXT,
      air_cooled_compatible TEXT,
      sewer_access TEXT,
      gas_availability TEXT,
      distance_to_gas_pipeline TEXT,
      existing_industrial_services TEXT
    )`,

    `CREATE TABLE IF NOT EXISTS community_stakeholder_info (
      site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
      community_attitude TEXT,
      history_protests TEXT,
      known_litigation TEXT,
      municipal_support TEXT,
      economic_dev_support TEXT,
      indigenous_engagement_req TEXT,
      indigenous_relationships TEXT,
      other_stakeholder_concerns TEXT
    )`,

    `CREATE TABLE IF NOT EXISTS contacts (
      site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
      name TEXT,
      company TEXT,
      email TEXT,
      phone TEXT,
      relationship_to_property TEXT,
      preferred_contact_method TEXT,
      comments TEXT
    )`,

    `CREATE TABLE IF NOT EXISTS assessment_results (
      site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
      classification TEXT,
      calculated_score REAL,
      confidence_level TEXT,
      key_strengths TEXT,
      verification_issues TEXT,
      potential_constraints TEXT,
      recommended_steps TEXT,
      raw_submission_json TEXT
    )`
  ];

  for (const stmt of statements) {
    try {
      await db.prepare(stmt).run();
    } catch (err) {
      console.error("Failed to execute SQL statement:", stmt);
      throw err;
    }
  }

  console.log("Database schema successfully initialized.");
}
