import { ensureSchema } from "./_schema.js";

export async function onRequestPost(context) {
  const db = context.env.DB;
  
  try {
    // 1. Ensure database is initialized
    await ensureSchema(db);
    
    // 2. Parse request payload
    const body = await context.request.json();
    const track = body.assessment_track === "micronode" ? "micronode" : "industrial";
    body.assessment_track = track;
    
    // 3. Compute Assessment according to selected track
    const result = track === "micronode"
      ? evaluateMicroNode(body)
      : evaluateIndustrialSite(body);
    
    // 4. Save to Database
    const siteId = await saveToDatabase(db, body, result, track);
    
    // Return result with siteId so the UI can display the tailored report and lead form
    return new Response(JSON.stringify({
      success: true,
      site_id: siteId,
      track: track,
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

// ============================================================================
// TRACK A: MicroNode / On-Premise Deployment Evaluation
// ============================================================================
function evaluateMicroNode(data) {
  const orgType = data.mn_org_type || "Other Enterprise";
  const primaryUseCase = data.mn_primary_use_case || "";
  const useCases = Array.isArray(data.mn_use_cases) ? data.mn_use_cases : (primaryUseCase ? [primaryUseCase] : []);
  const compliance = data.mn_compliance || "Standard Internal Security";
  const placement = data.mn_placement || "Not sure";
  const cooling = data.mn_cooling || "Not sure";
  const electrical = data.mn_electrical || "Not sure / needs site audit";
  const backupPower = data.mn_backup_power || "Not sure";
  const network = data.mn_network || "Not sure";
  const docVolume = data.mn_doc_volume || "Not sure";

  // Confidence calculation
  const checkFields = [placement, cooling, electrical, network, docVolume];
  const unknownCount = checkFields.filter(v => !v || v.toLowerCase().includes("not sure") || v.toLowerCase().includes("unknown")).length;
  let confidenceLevel = "High";
  if (unknownCount >= 3) confidenceLevel = "Low";
  else if (unknownCount >= 1) confidenceLevel = "Medium";

  let score = 0;

  // 1. Workload & Sovereignty Fit (Max 25 pts)
  score += 15; // Base score for sovereign on-premise AI need
  if (useCases.length > 0) score += 5;
  if (["BC FIPPA", "OCAP principles", "Client NDA / PIPEDA"].some(c => compliance.includes(c))) {
    score += 5;
  } else {
    score += 3;
  }

  // 2. Physical Space & Placement (Max 25 pts)
  if (placement.includes("Existing Server Room") || placement.includes("IT Closet")) {
    score += 18;
  } else if (placement.includes("Outdoor Yard") || placement.includes("Parking Stall")) {
    score += 17;
  } else if (placement.includes("Utility") || placement.includes("Electrical Room") || placement.includes("Dedicated Office")) {
    score += 15;
  } else {
    score += 8;
  }

  if (cooling.includes("Dedicated") || cooling.includes("Outdoor")) {
    score += 7;
  } else if (cooling.includes("Standard building HVAC")) {
    score += 5;
  } else {
    score += 3;
  }

  // 3. Electrical Service Availability (Max 30 pts)
  if (electrical.includes("100A+")) {
    score += 30;
  } else if (electrical.includes("30A–50A") || electrical.includes("30A-50A")) {
    score += 27;
  } else if (electrical.includes("Standard 120V / 208V / 240V")) {
    score += 20;
  } else {
    score += 10;
  }

  // 4. Connectivity & Network Boundary (Max 20 pts)
  if (network.includes("Isolated internal VLAN") || network.includes("dedicated ISP bypass")) {
    score += 20;
  } else if (network.includes("Existing commercial internet") || network.includes("Air-gapped")) {
    score += 16;
  } else {
    score += 10;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Classification
  let classification = "Electrical / Network Audit Needed";
  const needsElecAudit = electrical.toLowerCase().includes("not sure") || electrical.toLowerCase().includes("audit");
  const needsNetAudit = network.toLowerCase().includes("not sure");
  const needsPlaceAudit = placement.toLowerCase().includes("not sure");

  if (score >= 78 && !needsElecAudit && !needsPlaceAudit) {
    classification = "Ready for Pilot";
  } else if (score >= 60 && !(needsElecAudit && needsNetAudit)) {
    classification = "Ready for Pilot — Minor Prep Needed";
  } else {
    classification = "Electrical / Network Audit Needed";
  }

  // Strengths
  const strengths = [];
  strengths.push(`Strong sovereign AI alignment for ${orgType} (${compliance}).`);
  if (useCases.length > 0) {
    strengths.push(`Well-defined on-premise workload: ${useCases.join(", ")}.`);
  }
  if (placement.includes("Existing Server Room")) {
    strengths.push("Existing server room / IT closet provides a turnkey indoor placement footprint.");
  } else if (placement.includes("Outdoor Yard")) {
    strengths.push("Outdoor yard / parking stall allows an exterior weatherproof MicroNode mini-pod with zero indoor space or HVAC impact.");
  } else if (!needsPlaceAudit) {
    strengths.push(`Identified physical placement location (${placement}).`);
  }
  if (electrical.includes("100A+") || electrical.includes("30A")) {
    strengths.push(`Available electrical service (${electrical}) readily supports multi-GPU MicroNode hardware.`);
  } else if (electrical.includes("Standard 120V")) {
    strengths.push("Standard commercial power available for an entry-level MicroNode appliance.");
  }
  if (network.includes("VLAN") || network.includes("ISP bypass")) {
    strengths.push(`Clean network boundary option (${network}) keeps private data isolated while enabling remote management.`);
  }

  // Verification items
  const verifications = [];
  if (needsElecAudit) {
    verifications.push("Confirm available breaker amperage and receptacle voltage (208V/240V vs. 120V) in the proposed room.");
  } else {
    verifications.push("Verify exact plug/receptacle type (e.g., NEMA L6-30P) and cable run distance to the MicroNode rack.");
  }
  if (cooling.includes("Standard building HVAC") || cooling.toLowerCase().includes("not sure")) {
    verifications.push("Check room airflow and continuous heat rejection capacity (approx. 2–5 kW thermal load depending on GPU configuration).");
  }
  if (needsNetAudit) {
    verifications.push("Coordinate with internal IT or managed service provider on firewall rules and local VLAN segmentation.");
  }
  if (docVolume && !docVolume.toLowerCase().includes("not sure")) {
    verifications.push(`Validate storage sizing and ingestion connectors for ${docVolume} monthly document volume.`);
  } else {
    verifications.push("Estimate initial document repository size (PDFs, Word files, policies, or databases) for the 90-day pilot.");
  }

  // Potential Constraints
  const constraints = [];
  if (electrical.includes("Standard 120V")) {
    constraints.push("Standard 15A/20A 120V circuits limit peak GPU count; upgrading to a dedicated 208V/240V 30A circuit is recommended for higher concurrency.");
  }
  if (needsElecAudit) {
    constraints.push("Electrical panel capacity is currently unverified and will require a quick check by your facility electrician or our team.");
  }
  if (placement.includes("Dedicated Office") || cooling.includes("Standard building HVAC")) {
    constraints.push("Indoor office or utility rooms without dedicated cooling may experience warmth or fan acoustics under heavy batch workloads.");
  }
  if (!backupPower || backupPower.includes("no backup") || backupPower.toLowerCase().includes("not sure")) {
    constraints.push("Adding a line-interactive UPS is recommended to protect local inference hardware from brief utility brownouts.");
  }
  if (constraints.length === 0) {
    constraints.push("No major physical or electrical blockers identified based on submitted details.");
  }

  // Recommended Next Steps
  const steps = [
    "Schedule a 15-minute MicroNode Pilot Assessment call to confirm model sizing and document connectors.",
    needsElecAudit
      ? "Take a quick photo of your electrical subpanel and proposed placement area for our deployment team to review."
      : `Confirm physical clearance and receptacle specs at your ${placement.toLowerCase()}.`,
    `Define a 30-to-90 day pilot scope around ${useCases[0] || "your primary AI workflow"} under ${compliance} governance.`
  ];

  return {
    track: "micronode",
    track_label: "Track A: MicroNode / On-Premise Deployment",
    score_title: "MicroNode Deployment Readiness Score",
    classification,
    calculated_score: score,
    confidence_level: confidenceLevel,
    key_strengths: strengths,
    verification_issues: verifications,
    potential_constraints: constraints,
    recommended_steps: steps
  };
}

// ============================================================================
// TRACK B: Industrial Power & Brownfield Siting Evaluation (Sub-10 MW Pipeline)
// ============================================================================
function evaluateIndustrialSite(data) {
  const siteClass = data.site_classification || data.current_property_use || "Industrial Site";
  const capBand = data.capacity_band || "";
  const firmPower = parseFloat(data.firm_power_available_mw) || mapCapacityBandToMw(capBand);
  const interconnect = data.interconnection_status || "";
  const timeToCap = data.time_to_capacity || "Unknown";
  const powerType = data.power_type || "Firm";
  const cost = parseFloat(data.delivered_cost_mwh) || 0;
  const fiberStatus = data.fiber_status || data.fibre_available || "Unknown";
  const padSpace = data.pad_space || "";
  const coolingSuitability = data.cooling_suitability || data.air_cooled_compatible || "Unknown";
  const zoningStatus = data.data_centre_permitted || "unknown";
  const communityAtt = data.community_attitude || "Neutral/unknown";

  // Confidence calculation
  const techFields = [capBand || data.firm_power_available_mw, interconnect, timeToCap, fiberStatus, coolingSuitability, zoningStatus];
  const unknownCount = techFields.filter(v => !v || String(v).toLowerCase().includes("unknown") || String(v).toLowerCase().includes("not sure")).length;
  let confidenceLevel = "High";
  if (unknownCount >= 3) confidenceLevel = "Low";
  else if (unknownCount >= 1) confidenceLevel = "Medium";

  let score = 0;

  // 1. Sub-10 MW Capacity & Speed-to-Power Fit (Max 35 pts)
  if (capBand === "1-3 MW" || capBand === "3-5 MW" || capBand === "5-10 MW" || (firmPower >= 1 && firmPower <= 10)) {
    score += 28; // Sweet spot: sub-10 MW avoids multi-year BC Hydro large-load transmission queue
  } else if (capBand === "10+ MW" || firmPower > 10) {
    score += 22; // Strong capacity, though >10 MW may trigger large-load transmission review if not already energized
  } else if (capBand === "< 1 MW" || (firmPower > 0 && firmPower < 1)) {
    score += 16; // Suitable for smaller MicroCluster
  } else {
    score += 10;
  }

  if (powerType.includes("Firm") || powerType.includes("Behind-the-meter") || powerType.includes("On-site")) {
    score += 7;
  } else if (powerType.includes("Curtailable") || powerType.includes("Interruptible")) {
    score += 4;
  } else {
    score += 3;
  }

  // 2. Interconnection Readiness (Max 30 pts)
  if (interconnect.includes("Transformer on ground + active utility account")) {
    score += 30;
  } else if (interconnect.includes("Transformer on ground")) {
    score += 25;
  } else if (interconnect.includes("Existing 25 kV feed") || interconnect.includes("Active utility account")) {
    score += 20;
  } else if (interconnect.includes("Requires utility upgrade")) {
    score += 8;
  } else {
    score += 12;
  }

  // Timeline adjustment
  if (timeToCap.includes("Immediate") || timeToCap.includes("< 6 months") || timeToCap.includes("< 1 year")) {
    score += 5;
  } else if (timeToCap.includes("24+ months") || timeToCap.includes("5+ years")) {
    score -= 8;
  }

  // 3. Fiber Connectivity (Max 15 pts)
  if (fiberStatus.includes("Lit dark fiber") || fiberStatus.includes("Multiple diverse")) {
    score += 15;
  } else if (fiberStatus.includes("Single lit carrier") || fiberStatus === "Yes" || fiberStatus === "Yes - on property") {
    score += 12;
  } else if (fiberStatus.includes("Nearby highway/rail")) {
    score += 8;
  } else if (fiberStatus.includes("Requires backhaul study") || fiberStatus === "No") {
    score += 3;
  } else {
    score += 6;
  }

  // 4. Pad Space, Dry-Cooling & Zoning (Max 20 pts)
  if (padSpace.includes("Existing concrete pad") || padSpace.includes("Existing high-bay")) {
    score += 8;
  } else if (padSpace.includes("Cleared flat land")) {
    score += 6;
  } else {
    score += 3;
  }

  if (coolingSuitability.includes("water-free closed-loop dry coolers") || coolingSuitability === "Yes") {
    score += 6;
  } else if (coolingSuitability.includes("Industrial water") || coolingSuitability.includes("Hybrid")) {
    score += 5;
  } else {
    score += 3;
  }

  if (zoningStatus === "permitted use" || zoningStatus === "No zoning restriction") {
    score += 6;
  } else if (zoningStatus === "discretionary approval") {
    score += 4;
  } else if (zoningStatus === "not permitted") {
    score -= 15;
  } else {
    score += 3;
  }

  // Cost bonus/penalty
  if (cost > 0 && cost <= 60) score += 3;
  else if (cost > 110) score -= 5;

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Classification
  let classification = "Conditional — Technical Verification Needed";
  const zoningBlocked = zoningStatus === "not permitted" || zoningStatus === "No";
  const requiresMajorUpgrade = interconnect.includes("Requires utility upgrade") || timeToCap.includes("24+ months") || timeToCap.includes("5+ years");

  if (zoningBlocked || score < 38) {
    classification = "Outside Fast-Track Parameters";
  } else if (score >= 76 && !requiresMajorUpgrade && fiberStatus !== "Requires backhaul study") {
    classification = "Fast-Track Qualified (Sub-10 MW Speed-to-Power)";
  } else if (score >= 58) {
    classification = "Promising Brownfield Candidate — Verification Needed";
  } else {
    classification = "Longer-Lead Upgrade / Due Diligence Required";
  }

  // Strengths
  const strengths = [];
  if (capBand === "1-3 MW" || capBand === "3-5 MW" || capBand === "5-10 MW") {
    strengths.push(`Target capacity (${capBand}) sits inside the sub-10 MW distribution window, avoiding multi-year high-voltage transmission queues.`);
  } else if (firmPower > 0) {
    strengths.push(`Identified ${firmPower} MW of energized or available site power capacity.`);
  }
  if (siteClass) {
    strengths.push(`Existing ${siteClass.toLowerCase()} profile provides established industrial land-use history.`);
  }
  if (interconnect.includes("Transformer on ground")) {
    strengths.push(`Existing transformer infrastructure on-site (${interconnect}) significantly compresses energization lead time.`);
  } else if (interconnect.includes("25 kV")) {
    strengths.push("Existing 25 kV distribution feed at property line supports rapid medium-voltage step-down.");
  }
  if (fiberStatus.includes("Lit dark fiber") || fiberStatus.includes("Single lit carrier") || fiberStatus.includes("Multiple diverse")) {
    strengths.push(`Fiber connectivity present (${fiberStatus}) to support low-latency inference traffic.`);
  }
  if (coolingSuitability.includes("water-free") || coolingSuitability === "Yes") {
    strengths.push("Compatible with water-free closed-loop dry coolers, eliminating municipal water draw and wastewater permitting hurdles.");
  }
  if (padSpace.includes("Existing concrete pad") || padSpace.includes("Existing high-bay")) {
    strengths.push(`Turnkey physical footprint (${padSpace}) ready for modular compute pods or racking.`);
  }

  // Verifications
  const verifications = [];
  verifications.push("Review recent utility bills, single-line electrical diagrams (SLD), and transformer nameplate ratings (MVA & impedance).");
  if (interconnect.toLowerCase().includes("not sure") || capBand === "Unknown") {
    verifications.push("Confirm firm contract demand (MW) with the utility account representative.");
  }
  if (fiberStatus.includes("highway/rail") || fiberStatus.includes("backhaul") || fiberStatus.toLowerCase().includes("not sure")) {
    verifications.push("Verify fiber splice point distance and carrier lateral construction quote to the equipment pad.");
  } else {
    verifications.push("Confirm carrier SLA, route diversity, and round-trip latency to Vancouver / Calgary / Seattle internet exchanges.");
  }
  if (zoningStatus === "unknown" || zoningStatus === "discretionary approval") {
    verifications.push("Confirm municipal industrial zoning bylaws regarding modular data center containers and acoustic limits at the property boundary.");
  }

  // Constraints
  const constraints = [];
  if (requiresMajorUpgrade) {
    constraints.push("Site requires utility distribution/feeder upgrades, which may extend speed-to-power beyond the 6–12 month fast-track window.");
  }
  if (capBand === "10+ MW") {
    constraints.push("Requests above 10 MW may trigger formal BC Hydro / utility large-load transmission queue studies unless behind-the-meter or phased.");
  }
  if (fiberStatus.includes("Requires backhaul study") || fiberStatus === "No") {
    constraints.push("Lack of immediate lit fiber at the property line will require last-mile trenching or microwave/dark-fiber buildout.");
  }
  if (communityAtt.includes("opposition") || communityAtt.includes("sensitivity")) {
    constraints.push("Nearby residential or acoustic sensitivity requires low-decibel dry-cooler fans and acoustic attenuation barriers.");
  }
  if (constraints.length === 0) {
    constraints.push("No major fast-track disqualifiers identified based on initial brownfield parameters.");
  }

  // Next Steps
  const steps = [
    "Submit your site below for an Ocean Falls Infrastructure & Speed-to-Power Review.",
    "Gather the existing electrical single-line diagram (SLD), transformer nameplate photo, and latest utility demand statement.",
    "Evaluate modular MicroCluster layout, dry-cooler acoustic footprint, and specialized AI infrastructure insurance profiling."
  ];

  return {
    track: "industrial",
    track_label: "Track B: Industrial Power / Brownfield Siting",
    score_title: "Speed-to-Power Readiness Score",
    classification,
    calculated_score: score,
    confidence_level: confidenceLevel,
    key_strengths: strengths,
    verification_issues: verifications,
    potential_constraints: constraints,
    recommended_steps: steps
  };
}

function mapCapacityBandToMw(band) {
  if (!band) return 0;
  if (band === "1-3 MW") return 2;
  if (band === "3-5 MW") return 4;
  if (band === "5-10 MW") return 7.5;
  if (band === "10+ MW") return 12;
  if (band === "< 1 MW") return 0.5;
  return 0;
}

// ============================================================================
// Database Persistence (Supports both Track A and Track B cleanly)
// ============================================================================
async function saveToDatabase(db, body, result, track) {
  const isMicroNode = track === "micronode";

  // Map common & track-specific fields into the relational schema so Admin Table & CSV exports work seamlessly
  const siteName = body.property_name || body.mn_org_name || (isMicroNode ? `${body.mn_org_type || "Enterprise"} MicroNode` : "Unnamed Industrial Site");
  const streetAddress = body.street_address || body.mn_placement || "";
  const city = body.city || body.mn_city || "";
  const provinceState = body.province_state || body.mn_province || "BC";
  const country = body.country || "Canada";
  const acreage = body.acreage ? parseFloat(body.acreage) : null;

  const currentUse = isMicroNode
    ? (body.mn_org_type || "On-Premise Enterprise")
    : (body.site_classification || body.current_property_use || "");

  const existingInfra = isMicroNode
    ? `Placement: ${body.mn_placement || "-"} | Cooling: ${body.mn_cooling || "-"}`
    : (body.pad_space || body.existing_infra || "");

  const existingElecInfra = isMicroNode
    ? `Service: ${body.mn_electrical || "-"} | Backup: ${body.mn_backup_power || "-"}`
    : (body.interconnection_status || body.existing_electrical_infra || "");

  const ownershipStatus = body.ownership_status || (isMicroNode ? body.mn_org_type : "");
  const opportunityType = isMicroNode
    ? `MicroNode Pilot (${body.mn_primary_use_case || "On-Premise AI"})`
    : (body.opportunity_type || "Industrial Power Siting");

  const firmMw = isMicroNode
    ? 0.02
    : (body.firm_power_available_mw && body.firm_power_available_mw !== "Unknown"
        ? parseFloat(body.firm_power_available_mw)
        : (mapCapacityBandToMw(body.capacity_band) || null));

  const maxMw = isMicroNode
    ? 0.05
    : (body.max_potential_capacity_mw && body.max_potential_capacity_mw !== "Unknown"
        ? parseFloat(body.max_potential_capacity_mw)
        : firmMw);

  const targetMw = body.target_size_mw ? parseFloat(body.target_size_mw) : firmMw;

  const projectTypesList = isMicroNode
    ? (Array.isArray(body.mn_use_cases) && body.mn_use_cases.length ? body.mn_use_cases : [body.mn_primary_use_case || "MicroNode Inference"])
    : (Array.isArray(body.project_types) && body.project_types.length ? body.project_types : ["Industrial Compute"]);

  // 1. Insert Site
  const siteInsert = await db.prepare(`
    INSERT INTO sites (
      name, address, city, province_state, country, acreage, current_use, 
      existing_infra, existing_electrical_infra, ownership_status, 
      opportunity_type, target_size_mw, project_types, created_at, assessment_track
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    siteName,
    streetAddress,
    city,
    provinceState,
    country,
    acreage,
    currentUse,
    existingInfra,
    existingElecInfra,
    ownershipStatus,
    opportunityType,
    targetMw,
    JSON.stringify(projectTypesList),
    new Date().toISOString(),
    track
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
    firmMw,
    firmMw,
    body.additional_power_mw && body.additional_power_mw !== "Unknown" ? parseFloat(body.additional_power_mw) : null,
    maxMw,
    isMicroNode ? (body.mn_electrical || "") : (body.power_type || body.capacity_band || ""),
    body.utility_provider || "",
    isMicroNode ? (body.mn_backup_power || "Commercial Building Service") : (body.interconnection_status || body.grid_status || ""),
    body.substation_on_near_site || "",
    body.transmission_infra || "",
    isMicroNode ? "120V/208V/240V" : (body.voltage_kv || "25 kV / Industrial"),
    body.time_to_capacity || (isMicroNode ? "Immediate / Pilot" : ""),
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
    isMicroNode ? (body.mn_network || "") : (body.fiber_status || body.fibre_available || ""),
    body.fibre_providers || "",
    body.diverse_routes || "",
    body.distance_to_fibre || "",
    isMicroNode ? `Monthly Doc Volume: ${body.mn_doc_volume || "-"}` : (body.telecom_infra || ""),
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
    isMicroNode ? (body.mn_compliance || "") : (body.zoning || body.site_classification || ""),
    body.data_centre_permitted || (isMicroNode ? "On-Premise Appliance" : ""),
    body.permitting_complexity || "",
    body.environmental_approvals || "",
    body.environmental_restrictions || "",
    body.flood_exposure || "",
    body.wildfire_exposure || "",
    body.seismic_exposure || "",
    body.other_natural_hazards || "",
    body.site_access_roads || "",
    body.proximity_airport_port || "",
    isMicroNode ? (body.mn_notes || "") : (body.construction_logistics_constraints || "")
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
    body.water_availability || "Water-free dry cooling",
    body.municipal_water || "",
    body.industrial_water || "",
    isMicroNode ? (body.mn_cooling || "Yes") : (body.cooling_suitability || body.air_cooled_compatible || "Yes"),
    body.sewer_access || "",
    body.gas_availability || "",
    body.distance_to_gas_pipeline || "",
    isMicroNode ? (body.mn_placement || "") : (body.pad_space || body.existing_industrial_services || "")
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
    isMicroNode && (body.mn_compliance || "").includes("OCAP") ? "Yes (OCAP Sovereignty)" : (body.indigenous_engagement_req || ""),
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
