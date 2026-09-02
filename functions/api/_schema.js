export async function ensureSchema(db) {
  // 1. Ensure core sites tables exist
  let sitesExist = false;
  try {
    await db.prepare("SELECT id FROM sites LIMIT 1").first();
    sitesExist = true;
  } catch (e) {
    console.log("Sites table not found. Initializing sites schema...");
  }

  if (!sitesExist) {
    const siteStatements = [
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

    for (const stmt of siteStatements) {
      try {
        await db.prepare(stmt).run();
      } catch (err) {
        console.error("Failed to execute SQL statement:", stmt);
        throw err;
      }
    }
  }

  // 2. Ensure datacentres table exists
  let datacentresExist = false;
  try {
    await db.prepare("SELECT id FROM datacentres LIMIT 1").first();
    datacentresExist = true;
  } catch (e) {
    console.log("Datacentres table not found. Initializing datacentres schema...");
  }

  if (!datacentresExist) {
    const dcStatements = [
      `CREATE TABLE IF NOT EXISTS datacentres (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT,
        city TEXT NOT NULL,
        province_state TEXT NOT NULL,
        country TEXT DEFAULT 'Canada',
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        capacity_mw REAL,
        capacity_display TEXT,
        proposal_status TEXT DEFAULT 'proposed',
        site_type TEXT DEFAULT 'datacentre',
        developer TEXT,
        noise_radius_m REAL DEFAULT 1500,
        source_url TEXT,
        announced_date TEXT,
        notes TEXT,
        ai_tag INTEGER DEFAULT 0,
        is_visible INTEGER DEFAULT 1,
        created_at TEXT,
        updated_at TEXT,
        extra_json TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_datacentres_visible ON datacentres(is_visible)`,
      `CREATE INDEX IF NOT EXISTS idx_datacentres_city ON datacentres(city)`,
      `CREATE INDEX IF NOT EXISTS idx_datacentres_province ON datacentres(province_state)`
    ];

    for (const stmt of dcStatements) {
      try {
        await db.prepare(stmt).run();
      } catch (err) {
        console.error("Failed to execute SQL statement:", stmt);
        throw err;
      }
    }
  }

  // 3. Ensure baseline Canadian datacentre catalog is seeded into D1
  try {
    const countRow = await db.prepare("SELECT COUNT(*) as cnt FROM datacentres WHERE id LIKE 'national:%'").first();
    if (!countRow || countRow.cnt < 50) {
      console.log(`Baseline catalog missing (found ${countRow ? countRow.cnt : 0}). Auto-seeding default Canadian datacentres...`);
      await seedDefaultDatacentres(db);
    }
  } catch (err) {
    console.error("Auto-seed check error:", err);
  }

  console.log("Database schema successfully verified and initialized.");
}

export async function seedDefaultDatacentres(db) {
  try {
    const { DEFAULT_DATACENTRES } = await import("./_default_datacentres.js");
    if (!DEFAULT_DATACENTRES || !DEFAULT_DATACENTRES.length) return;

    const now = new Date().toISOString();
    const stmts = [];

    for (const d of DEFAULT_DATACENTRES) {
      stmts.push(db.prepare(`
        INSERT INTO datacentres (
          id, name, address, city, province_state, country,
          lat, lng, capacity_mw, capacity_display, proposal_status,
          site_type, developer, noise_radius_m, source_url,
          notes, ai_tag, is_visible, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, 'Canada',
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          address = excluded.address,
          city = excluded.city,
          province_state = excluded.province_state,
          lat = excluded.lat,
          lng = excluded.lng,
          capacity_mw = excluded.capacity_mw,
          capacity_display = excluded.capacity_display,
          proposal_status = excluded.proposal_status,
          site_type = excluded.site_type,
          developer = excluded.developer,
          noise_radius_m = excluded.noise_radius_m,
          source_url = excluded.source_url,
          notes = excluded.notes,
          ai_tag = excluded.ai_tag,
          updated_at = excluded.updated_at
      `).bind(
        d.id,
        d.name,
        d.address || "",
        d.city,
        d.province_state,
        Number(d.lat),
        Number(d.lng),
        d.capacity_mw != null ? Number(d.capacity_mw) : null,
        d.capacity_display || (d.capacity_mw ? `${d.capacity_mw} MW` : "Unknown"),
        d.proposal_status || "proposed",
        d.site_type || "datacentre",
        d.developer || "",
        Number(d.noise_radius_m) || 1500,
        d.source_url || "",
        d.notes || "",
        d.ai_tag || 0,
        d.is_visible !== 0 ? 1 : 0,
        now,
        now
      ));
    }

    // Execute in batches of 40 to stay comfortably within D1 batch limits
    for (let i = 0; i < stmts.length; i += 40) {
      await db.batch(stmts.slice(i, i + 40));
    }
    console.log(`Successfully seeded ${stmts.length} default datacentres.`);
  } catch (err) {
    console.error("Error in seedDefaultDatacentres:", err);
  }
}
