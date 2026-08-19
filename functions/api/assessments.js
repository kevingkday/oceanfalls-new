import { ensureSchema } from "./_schema.js";

export async function onRequestPost(context) {
  const db = context.env.DB;
  
  try {
    // 1. Ensure database is initialized
    await ensureSchema(db);
    
    // 2. Parse request payload
    const body = await context.request.json();
    
    // 3. Compute Assessment
    const result = evaluateSite(body);
    
    // 4. Save to Database
    const siteId = await saveToDatabase(db, body, result);
    
    // Return result with siteId so the UI can redirect or display lead forms
    return new Response(JSON.stringify({
      success: true,
      site_id: siteId,
      result: result
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("Error processing site assessment:", error);
    return new Response(JSON.stringify({
      success: false,
      message: "Internal server error while processing assessment.",
      error: error.message
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

// Assessment scoring and grouping logic
function evaluateSite(data) {
  // Extract inputs with sensible defaults
  const firmPower = parseFloat(data.firm_power_available_mw) || 0;
  const addPower = parseFloat(data.additional_power_mw) || 0;
  const maxPower = parseFloat(data.max_potential_capacity_mw) || 0;
  const powerType = data.power_type || "Unknown";
  const cost = parseFloat(data.delivered_cost_mwh) || 0;
  const genSource = data.generation_source || "Unknown";
  const renewPct = parseFloat(data.renewable_pct) || 0;
  const timeToCap = data.time_to_capacity || "Unknown";
  const substation = data.substation_on_near_site || "Unknown";
  const existingElectricalInfra = data.existing_electrical_infra || "";
  const existingInfra = data.existing_infra || "";
  
  const fibreAvailable = data.fibre_available || "Unknown";
  const diverseRoutes = data.diverse_routes || "Unknown";
  const distFibre = data.distance_to_fibre || "Unknown";
  
  const zoning = data.zoning || "";
  const dcPermitted = data.data_centre_permitted || "unknown";
  const permitComplex = data.permitting_complexity || "Unknown";
  const envApprovals = data.environmental_approvals || "";
  const envRestrictions = data.environmental_restrictions || "";
  const floodExp = data.flood_exposure || "Unknown";
  const wildfireExp = data.wildfire_exposure || "Unknown";
  const seismicExp = data.seismic_exposure || "Unknown";
  const acreage = parseFloat(data.acreage) || 0;
  
  const waterAvail = data.water_availability || "Unknown";
  const communityAtt = data.community_attitude || "Neutral/unknown";
  const protests = data.history_protests || "No";
  const litigation = data.known_litigation || "No";
  const indigenousReq = data.indigenous_engagement_req || "Unknown";
  const indigenousRel = data.indigenous_relationships || "Unknown";
  
  // Calculate Confidence Level
  // Count how many technical fields are answered as "Unknown" or not filled
  const technicalFields = [
    data.firm_power_available_mw,
    data.additional_power_mw,
    data.power_type,
    data.substation_on_near_site,
    data.delivered_cost_mwh,
    data.generation_source,
    data.fibre_available,
    data.diverse_routes,
    data.distance_to_fibre,
    data.data_centre_permitted,
    data.permitting_complexity,
    data.flood_exposure,
    data.wildfire_exposure,
    data.seismic_exposure,
    data.water_availability,
    data.community_attitude,
    data.indigenous_engagement_req
  ];
  
  const unknownCount = technicalFields.filter(val => 
    val === undefined || 
    val === null || 
    val === "" || 
    val === "Unknown" || 
    val === "unknown" || 
    val === "Unknown / Not Sure" || 
    val === "Neutral/unknown"
  ).length;
  
  const totalTechFields = technicalFields.length;
  const knownRatio = (totalTechFields - unknownCount) / totalTechFields;
  
  let confidenceLevel = "Medium";
  if (knownRatio >= 0.8) {
    confidenceLevel = "High";
  } else if (knownRatio < 0.45) {
    confidenceLevel = "Low";
  }

  // --- 1. POWER SCORE (Max 50 points) ---
  let powerScore = 0;
  
  // Firm capacity mapping
  if (firmPower >= 20) {
    powerScore += 35;
  } else if (firmPower >= 5) {
    powerScore += 25;
  } else if (firmPower >= 1) {
    powerScore += 15;
  } else if (firmPower > 0) {
    powerScore += 10;
  } else if (data.firm_power_available_mw === "Unknown" || data.firm_power_available_mw === "") {
    powerScore += 8; // penalty for unknown but not 0
  }
  
  // Speculative capacity (discounted by 70%)
  const speculativePower = Math.max(0, Math.max(addPower, maxPower) - firmPower);
  if (speculativePower >= 50) {
    powerScore += 10;
  } else if (speculativePower >= 10) {
    powerScore += 7;
  } else if (speculativePower > 0) {
    powerScore += 4;
  }
  
  // Power reliability
  if (powerType === "Firm") {
    powerScore += 5;
  } else if (powerType === "Interruptible" || powerType === "Curtailable") {
    powerScore += 2;
  }
  
  // Substation proximity
  if (substation === "Yes" || substation === "On site" || substation === "Near site (< 1 km)") {
    powerScore += 5;
  } else if (substation === "Unknown") {
    powerScore += 2;
  }
  
  // Delivered cost mapping
  if (cost > 0) {
    if (cost <= 50) {
      powerScore += 5;
    } else if (cost <= 80) {
      powerScore += 3;
    } else if (cost > 120) {
      powerScore -= 5; // penalty for expensive power
    }
  }
  
  // Low carbon/renewables bonus
  if (renewPct >= 80 || ["Hydro", "Nuclear", "Wind", "Solar"].includes(genSource)) {
    powerScore += 5;
  } else if (renewPct >= 50) {
    powerScore += 3;
  }
  
  powerScore = Math.max(0, Math.min(50, powerScore));

  // --- 2. CONNECTIVITY SCORE (Max 25 points) ---
  let connScore = 0;
  
  if (fibreAvailable === "Yes" || fibreAvailable === "Yes - on property") {
    connScore += 10;
  } else if (fibreAvailable === "Unknown") {
    connScore += 5;
  }
  
  if (diverseRoutes === "Three or more") {
    connScore += 10;
  } else if (diverseRoutes === "Two") {
    connScore += 8;
  } else if (diverseRoutes === "One") {
    connScore += 4;
  } else if (diverseRoutes === "Unknown") {
    connScore += 4;
  }
  
  if (distFibre === "On site" || distFibre === "< 500m" || distFibre === "< 1 km") {
    connScore += 5;
  } else if (distFibre === "Unknown") {
    connScore += 2;
  }
  
  connScore = Math.max(0, Math.min(25, connScore));

  // --- 3. DEVELOPMENT & INFRASTRUCTURE SCORE (Max 25 points) ---
  let devScore = 0;
  
  // Zoning
  if (dcPermitted === "permitted use" || dcPermitted === "No zoning restriction") {
    devScore += 10;
  } else if (dcPermitted === "discretionary approval") {
    devScore += 7;
  } else if (dcPermitted === "rezoning required") {
    devScore += 3;
  } else if (dcPermitted === "unknown") {
    devScore += 5;
  }
  
  // Permitting complexity
  if (permitComplex === "Low complexity") {
    devScore += 5;
  } else if (permitComplex === "Moderate complexity" || permitComplex === "Unknown") {
    devScore += 3;
  }
  
  // Natural hazards checks
  let hazardPenalty = 0;
  if (floodExp === "High" || floodExp === "Yes") hazardPenalty += 3;
  if (wildfireExp === "High" || wildfireExp === "Yes") hazardPenalty += 3;
  if (seismicExp === "High" || seismicExp === "Yes") hazardPenalty += 3;
  devScore += Math.max(0, 5 - hazardPenalty);
  
  // Water availability
  if (waterAvail === "Abundant" || waterAvail === "Moderate") {
    devScore += 5;
  } else if (waterAvail === "Unknown") {
    devScore += 3;
  }
  
  devScore = Math.max(0, Math.min(25, devScore));

  // --- TOTAL SCORE & CLASSIFICATION ---
  const totalScore = powerScore + connScore + devScore;
  
  // Determine Classification using gates
  let classification = "Significant Due Diligence Required";
  
  const zoningBlocker = dcPermitted === "No" || dcPermitted === "not permitted";
  const absolutePowerBlocker = (firmPower === 0 && addPower === 0 && maxPower === 0 && 
                                (data.firm_power_available_mw === "0" || data.firm_power_available_mw === "None") &&
                                (data.additional_power_mw === "0" || data.additional_power_mw === "None"));
  
  if (zoningBlocker || absolutePowerBlocker || totalScore < 35) {
    classification = "Unlikely Based on Current Information";
  } else if (confidenceLevel === "Low" || totalScore < 55) {
    classification = "Significant Due Diligence Required";
  } else if (totalScore >= 75 && 
             (dcPermitted === "permitted use" || dcPermitted === "No zoning restriction" || dcPermitted === "discretionary approval") && 
             (firmPower >= 5 || data.firm_power_available_mw === "Unknown") && 
             fibreAvailable !== "No") {
    classification = "Promising";
  } else {
    classification = "Conditional";
  }

  // --- Key Strengths ---
  const strengths = [];
  if (firmPower >= 10) strengths.push(`Significant firm power available (${firmPower} MW)`);
  if (speculativePower >= 20) strengths.push("Substantial expansion or potential capacity identified");
  if (cost > 0 && cost <= 65) strengths.push(`Competitive power cost ($${cost}/MWh)`);
  if (renewPct >= 70 || ["Hydro", "Nuclear", "Wind", "Solar"].includes(genSource)) {
    strengths.push(`Low-carbon electricity (${renewPct || 100}% renewable/low carbon)`);
  }
  if (existingElectricalInfra || existingInfra) strengths.push("Existing industrial or electrical infrastructure present");
  if (diverseRoutes === "Two" || diverseRoutes === "Three or more") strengths.push(`Multiple physically diverse fibre routes (${diverseRoutes})`);
  if (dcPermitted === "permitted use" || dcPermitted === "No zoning restriction") strengths.push("Data centre permitted under existing zoning");
  if (waterAvail === "Abundant") strengths.push("Abundant water resources available");
  if (communityAtt === "Supportive" || communityAtt === "Mostly supportive") strengths.push("Supportive community attitude toward industrial development");
  if (strengths.length === 0) strengths.push("Access to power grid or potential utility capacity");

  // --- Issues Requiring Verification ---
  const verifications = [];
  if (data.firm_power_available_mw === "Unknown" || data.firm_power_available_mw === "") {
    verifications.push("Firm power availability has not been confirmed by the utility");
  }
  if (timeToCap === "Unknown" || timeToCap === "") {
    verifications.push("Interconnection schedule and capacity study timeline unknown");
  }
  if (fibreAvailable === "Unknown") {
    verifications.push("Fibre presence and bandwidth capacity need to be checked");
  }
  if (diverseRoutes === "Unknown") {
    verifications.push("Number of physically diverse fibre routing paths unverified");
  }
  if (dcPermitted === "unknown" || zoning === "") {
    verifications.push("Zoning classification and permitted uses require legal confirmation");
  }
  if (waterAvail === "Unknown") {
    verifications.push("Water supply capacity and flow rates have not been assessed");
  }
  if (indigenousReq === "Unknown") {
    verifications.push("Indigenous consultation and engagement requirements must be identified");
  }
  if (verifications.length === 0) verifications.push("Complete physical site access and road conditions survey");

  // --- Potential Constraints ---
  const constraints = [];
  if (data.firm_power_available_mw === "0" || firmPower === 0) {
    constraints.push("No firm power currently available (all power is speculative/additional)");
  }
  if (timeToCap === "5+ years" || timeToCap === "2-5 years") {
    constraints.push(`Extended interconnection timeline to secure capacity (${timeToCap})`);
  }
  if (powerType === "Interruptible" || powerType === "Curtailable") {
    constraints.push(`Power contract subject to utility load curtailment or interruption (${powerType})`);
  }
  if (cost >= 100) {
    constraints.push(`High delivered electricity cost ($${cost}/MWh) impacting operational margins`);
  }
  if (diverseRoutes === "None known" || diverseRoutes === "One") {
    constraints.push("Lack of physically diverse fibre routing (single point of connectivity failure risk)");
  }
  if (dcPermitted === "rezoning required") {
    constraints.push("Rezoning process required, representing permitting schedule risk");
  }
  if (dcPermitted === "No" || dcPermitted === "not permitted") {
    constraints.push("Data centres explicitly prohibited under current zoning");
  }
  if (acreage > 0 && acreage < 10) {
    constraints.push(`Small site footprint (${acreage} acres) limiting hyperscale or future expansion`);
  }
  if (floodExp === "High" || wildfireExp === "High" || seismicExp === "High") {
    constraints.push("High natural hazard risk (flood, wildfire, or seismic exposure)");
  }
  if (waterAvail === "Scarce") {
    constraints.push("Scarce local water resources (low-water or closed-loop dry cooling required)");
  }
  if (communityAtt === "Some opposition" || communityAtt === "Significant opposition" || protests === "Yes" || litigation === "Yes") {
    constraints.push("Known community opposition or litigation risk regarding industrial projects");
  }

  // --- Recommended Next Steps ---
  const steps = [];
  if (data.firm_power_available_mw === "Unknown") {
    steps.push("Submit formal capacity inquiry to the local utility to confirm firm MW availability.");
  }
  if (timeToCap === "Unknown") {
    steps.push("Engage electrical engineering consultants to complete a preliminary interconnection study.");
  }
  if (diverseRoutes === "Unknown" || fibreAvailable === "Unknown") {
    steps.push("Request fibre map checks and feasibility quotes from regional telecommunication providers.");
  }
  if (dcPermitted === "unknown" || dcPermitted === "rezoning required") {
    steps.push("Confirm zoning bylaws with municipal planners and evaluate rezoning schedule.");
  }
  if (envApprovals === "" || envRestrictions === "") {
    steps.push("Undertake an environmental database check and preliminary critical habitat screening.");
  }
  if (indigenousReq === "Yes" || indigenousReq === "Unknown") {
    steps.push("Review First Nations territory boundaries and establish a respectful consultation plan.");
  }
  if (floodExp === "Unknown" || wildfireExp === "Unknown") {
    steps.push("Conduct a preliminary natural hazard and risk review for insurance placement profiling.");
  }
  if (steps.length === 0) {
    steps.push("Initiate full site due diligence and feasibility assessment with Ocean Falls partners.");
  }

  return {
    classification,
    calculated_score: Math.round(totalScore),
    confidence_level: confidenceLevel,
    key_strengths: strengths,
    verification_issues: verifications,
    potential_constraints: constraints,
    recommended_steps: steps
  };
}

// Save inputs and results into the structured database
async function saveToDatabase(db, body, result) {
  // 1. Insert Site
  const projectTypesJson = JSON.stringify(body.project_types || []);
  const siteInsert = await db.prepare(`
    INSERT INTO sites (
      name, address, city, province_state, country, acreage, current_use, 
      existing_infra, existing_electrical_infra, ownership_status, 
      opportunity_type, target_size_mw, project_types, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    body.property_name || "Unnamed Property",
    body.street_address || "",
    body.city || "",
    body.province_state || "",
    body.country || "",
    body.acreage ? parseFloat(body.acreage) : null,
    body.current_property_use || "",
    body.existing_infra || "",
    body.existing_electrical_infra || "",
    body.ownership_status || "",
    body.opportunity_type || "",
    body.target_size_mw ? parseFloat(body.target_size_mw) : null,
    projectTypesJson,
    new Date().toISOString()
  ).run();
  
  const siteId = siteInsert.meta.last_row_id;
  
  // 2. Insert Power Info
  await db.prepare(`
    INSERT INTO power_info (
      site_id, existing_capacity_mw, firm_power_available_mw, additional_power_mw, 
      max_potential_capacity_mw, power_type, utility_provider, grid_status, 
      substation_on_near_site, transmission_infra, voltage_kv, time_to_capacity, 
      delivered_cost_mwh, generation_source, renewable_pct, has_ppa, 
      ppa_remaining_term, demand_restrictions, other_constraints
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    siteId,
    body.existing_capacity_mw ? parseFloat(body.existing_capacity_mw) : null,
    body.firm_power_available_mw && body.firm_power_available_mw !== "Unknown" ? parseFloat(body.firm_power_available_mw) : null,
    body.additional_power_mw && body.additional_power_mw !== "Unknown" ? parseFloat(body.additional_power_mw) : null,
    body.max_potential_capacity_mw && body.max_potential_capacity_mw !== "Unknown" ? parseFloat(body.max_potential_capacity_mw) : null,
    body.power_type || "",
    body.utility_provider || "",
    body.grid_status || "",
    body.substation_on_near_site || "",
    body.transmission_infra || "",
    body.voltage_kv || "",
    body.time_to_capacity || "",
    body.delivered_cost_mwh && body.delivered_cost_mwh !== "Unknown" ? parseFloat(body.delivered_cost_mwh) : null,
    body.generation_source || "",
    body.renewable_pct ? parseFloat(body.renewable_pct) : null,
    body.has_ppa || "",
    body.ppa_remaining_term || "",
    body.demand_restrictions || "",
    body.other_constraints || ""
  ).run();
  
  // 3. Insert Connectivity Info
  await db.prepare(`
    INSERT INTO connectivity_info (
      site_id, fibre_available, fibre_providers, diverse_routes, 
      distance_to_fibre, telecom_infra, latency_limitations
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    siteId,
    body.fibre_available || "",
    body.fibre_providers || "",
    body.diverse_routes || "",
    body.distance_to_fibre || "",
    body.telecom_infra || "",
    body.latency_limitations || ""
  ).run();
  
  // 4. Insert Development Info
  await db.prepare(`
    INSERT INTO development_info (
      site_id, zoning, data_centre_permitted, permitting_complexity, 
      environmental_approvals, environmental_restrictions, flood_exposure, 
      wildfire_exposure, seismic_exposure, other_natural_hazards, 
      site_access_roads, proximity_airport_port, construction_logistics_constraints
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    siteId,
    body.zoning || "",
    body.data_centre_permitted || "",
    body.permitting_complexity || "",
    body.environmental_approvals || "",
    body.environmental_restrictions || "",
    body.flood_exposure || "",
    body.wildfire_exposure || "",
    body.seismic_exposure || "",
    body.other_natural_hazards || "",
    body.site_access_roads || "",
    body.proximity_airport_port || "",
    body.construction_logistics_constraints || ""
  ).run();
  
  // 5. Insert Water & Infrastructure Info
  await db.prepare(`
    INSERT INTO water_infrastructure_info (
      site_id, water_availability, municipal_water, industrial_water, 
      air_cooled_compatible, sewer_access, gas_availability, 
      distance_to_gas_pipeline, existing_industrial_services
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    siteId,
    body.water_availability || "",
    body.municipal_water || "",
    body.industrial_water || "",
    body.air_cooled_compatible || "",
    body.sewer_access || "",
    body.gas_availability || "",
    body.distance_to_gas_pipeline || "",
    body.existing_industrial_services || ""
  ).run();
  
  // 6. Insert Community & Stakeholders
  await db.prepare(`
    INSERT INTO community_stakeholder_info (
      site_id, community_attitude, history_protests, known_litigation, 
      municipal_support, economic_dev_support, indigenous_engagement_req, 
      indigenous_relationships, other_stakeholder_concerns
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    siteId,
    body.community_attitude || "",
    body.history_protests || "",
    body.known_litigation || "",
    body.municipal_support || "",
    body.economic_dev_support || "",
    body.indigenous_engagement_req || "",
    body.indigenous_relationships || "",
    body.other_stakeholder_concerns || ""
  ).run();
  
  // 7. Insert empty Contact placeholder (will be filled in /api/lead)
  await db.prepare(`
    INSERT INTO contacts (
      site_id, name, company, email, phone, 
      relationship_to_property, preferred_contact_method, comments
    ) VALUES (?, '', '', '', '', '', '', '')
  `).bind(siteId).run();
  
  // 8. Insert Assessment Results
  await db.prepare(`
    INSERT INTO assessment_results (
      site_id, classification, calculated_score, confidence_level, 
      key_strengths, verification_issues, potential_constraints, 
      recommended_steps, raw_submission_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    siteId,
    result.classification,
    result.calculated_score,
    result.confidence_level,
    JSON.stringify(result.key_strengths),
    JSON.stringify(result.verification_issues),
    JSON.stringify(result.potential_constraints),
    JSON.stringify(result.recommended_steps),
    JSON.stringify(body)
  ).run();
  
  return siteId;
}
