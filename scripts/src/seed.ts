import {
  db,
  pool,
  jobsTable,
  stagesTable,
  stageLibraryTable,
  employeesTable,
  timeEntriesTable,
  estimatesTable,
  customersTable,
  contactsTable,
  customerAddressesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

const DEFAULT_STAGES = [
  "Estimating",
  "Fabrication",
  "Welding",
  "Paint",
  "Inspection",
  "Shipping",
];

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3600 * 1000);
}

async function main() {
  console.log("Clearing existing data...");
  await db.delete(timeEntriesTable);
  await db.delete(stagesTable);
  await db.delete(jobsTable);
  await db.delete(estimatesTable);
  await db.delete(contactsTable);
  await db.delete(customerAddressesTable);
  await db.delete(customersTable);
  await db.delete(employeesTable);
  await db.delete(stageLibraryTable);

  console.log("Seeding stage library...");
  const libraryStages = [
    ...DEFAULT_STAGES,
    "Sandblasting",
    "Galvanizing",
    "Layout",
    "Assembly",
  ];
  await db
    .insert(stageLibraryTable)
    .values(libraryStages.map((name) => ({ name })));

  console.log("Seeding employees...");
  const employees = await db
    .insert(employeesTable)
    .values([
      { name: "Marcus Reed", employeeCode: "W-101", active: true },
      { name: "Diana Cruz", employeeCode: "W-102", active: true },
      { name: "Sam Okafor", employeeCode: "W-103", active: true },
      { name: "Elena Petrov", employeeCode: "W-104", active: true },
      { name: "Tom Bradley", employeeCode: "W-105", active: false },
    ])
    .returning();

  console.log("Seeding customers...");
  const customerSpecs = [
    {
      name: "Freeport McMoran",
      phone: "(602) 366-8100",
      fax: "(602) 366-7300",
      email: "procurement@fmi.com",
      website: "https://www.fcx.com",
      billingAddress: "333 N Central Ave, Phoenix, AZ 85004",
      defaultDeliveryAddress: "Morenci Mine, 4521 US-191, Morenci, AZ 85540",
      industry: "Mining",
      status: "active",
      notes: "Net 45 terms. All shipments require mine-site safety induction paperwork.",
      contacts: [
        { name: "Carl Jensen", title: "Purchasing Manager", phone: "(602) 366-8144", mobile: "(602) 550-1287", email: "cjensen@fmi.com", isPrimary: true },
        { name: "Rita Alvarez", title: "Project Engineer", phone: "(602) 366-8190", email: "ralvarez@fmi.com", isPrimary: false },
      ],
      addresses: [
        { label: "Morenci Mine", address: "4521 US-191, Morenci, AZ 85540" },
        { label: "Bagdad Mine", address: "1 Main St, Bagdad, AZ 86321" },
      ],
    },
    {
      name: "Hatch",
      phone: "(905) 855-7600",
      fax: "(905) 855-8270",
      email: "vendors@hatch.com",
      website: "https://www.hatch.com",
      billingAddress: "2800 Speakman Dr, Mississauga, ON L5K 2R7",
      defaultDeliveryAddress: "Client site — per PO",
      industry: "Refinery/Petro-Chem",
      status: "active",
      notes: "EPC firm; delivery location varies per project PO.",
      contacts: [
        { name: "Priya Nair", title: "Procurement Lead", phone: "(905) 855-7688", mobile: "(416) 302-5541", email: "priya.nair@hatch.com", isPrimary: true },
      ],
      addresses: [
        { label: "Gulf Coast Project Site", address: "1802 Refinery Rd, Baytown, TX 77520" },
      ],
    },
    {
      name: "Babcock & Wilcox",
      phone: "(330) 753-4511",
      fax: "(330) 860-1886",
      email: "supplychain@babcock.com",
      website: "https://www.babcock.com",
      billingAddress: "1200 E Market St, Akron, OH 44305",
      defaultDeliveryAddress: "1200 E Market St, Akron, OH 44305",
      industry: "Power",
      status: "active",
      notes: "Weld procedure approvals required before fabrication start.",
      contacts: [
        { name: "Dale Whitmore", title: "Buyer", phone: "(330) 753-4590", email: "dwhitmore@babcock.com", isPrimary: true },
        { name: "Susan Park", title: "QA Coordinator", phone: "(330) 753-4622", email: "spark@babcock.com", isPrimary: false },
      ],
      addresses: [
        { label: "Akron Plant", address: "1200 E Market St, Akron, OH 44305" },
        { label: "Lancaster Job Site", address: "980 Power Plant Rd, Lancaster, OH 43130" },
      ],
    },
    {
      name: "GEA",
      phone: "(717) 268-6200",
      fax: "(717) 268-6162",
      email: "orders.us@gea.com",
      website: "https://www.gea.com",
      billingAddress: "3475 Board Rd, York, PA 17406",
      defaultDeliveryAddress: "3475 Board Rd, York, PA 17406",
      industry: "SCR",
      status: "active",
      notes: null,
      contacts: [
        { name: "Martin Keller", title: "Sourcing Specialist", phone: "(717) 268-6244", email: "martin.keller@gea.com", isPrimary: true },
      ],
      addresses: [
        { label: "York Facility", address: "3475 Board Rd, York, PA 17406" },
      ],
    },
    {
      name: "Ironclad Logistics",
      phone: "(480) 555-0142",
      fax: null,
      email: "ops@ironcladlogistics.com",
      website: null,
      billingAddress: "7810 W Buckeye Rd, Phoenix, AZ 85043",
      defaultDeliveryAddress: "7810 W Buckeye Rd, Phoenix, AZ 85043",
      industry: "Miscellaneous",
      status: "active",
      notes: "Galvanized finish standard on all structural work.",
      contacts: [
        { name: "Angela Torres", title: "Facilities Manager", phone: "(480) 555-0143", mobile: "(480) 555-9821", email: "atorres@ironcladlogistics.com", isPrimary: true },
      ],
      addresses: [
        { label: "Phoenix Warehouse", address: "7810 W Buckeye Rd, Phoenix, AZ 85043" },
      ],
    },
    {
      name: "Metro Public Works",
      phone: "(602) 555-0177",
      fax: "(602) 555-0178",
      email: "engineering@metropw.gov",
      website: null,
      billingAddress: "200 W Washington St, Phoenix, AZ 85003",
      defaultDeliveryAddress: "Bridge Site — 40th St & Canal, Phoenix, AZ",
      industry: "Miscellaneous",
      status: "active",
      notes: "Public agency — weld certs and inspection reports must accompany delivery.",
      contacts: [
        { name: "Hank Voss", title: "City Engineer", phone: "(602) 555-0179", email: "hvoss@metropw.gov", isPrimary: true },
      ],
      addresses: [
        { label: "Canal Bridge Site", address: "40th St & Canal, Phoenix, AZ 85018" },
      ],
    },
    {
      name: "Summit HVAC",
      phone: "(623) 555-0110",
      fax: null,
      email: "jobs@summithvac.com",
      website: "https://www.summithvac.com",
      billingAddress: "1420 N 27th Ave, Phoenix, AZ 85009",
      defaultDeliveryAddress: "1420 N 27th Ave, Phoenix, AZ 85009",
      industry: "Miscellaneous",
      status: "active",
      notes: null,
      contacts: [
        { name: "Beth Callahan", title: "Project Coordinator", phone: "(623) 555-0112", email: "beth@summithvac.com", isPrimary: true },
      ],
      addresses: [],
    },
    {
      name: "Grainway Mills",
      phone: "(520) 555-0166",
      fax: "(520) 555-0167",
      email: "maintenance@grainwaymills.com",
      website: null,
      billingAddress: "5100 S Grain Silo Rd, Casa Grande, AZ 85122",
      defaultDeliveryAddress: "5100 S Grain Silo Rd, Casa Grande, AZ 85122",
      industry: "Miscellaneous",
      status: "active",
      notes: "Gate check-in required; deliveries 6am-2pm only.",
      contacts: [
        { name: "Ray Duncan", title: "Plant Manager", phone: "(520) 555-0168", mobile: "(520) 555-3311", email: "rduncan@grainwaymills.com", isPrimary: true },
      ],
      addresses: [
        { label: "Casa Grande Mill", address: "5100 S Grain Silo Rd, Casa Grande, AZ 85122" },
      ],
    },
    {
      name: "Highrise Builders",
      phone: "(602) 555-0190",
      fax: null,
      email: "purchasing@highrisebuilders.com",
      website: "https://www.highrisebuilders.com",
      billingAddress: "2201 E Camelback Rd, Phoenix, AZ 85016",
      defaultDeliveryAddress: "Job site — per contract",
      industry: "Miscellaneous",
      status: "inactive",
      notes: "Past customer — stair/handrail packages. Inactive since project completion.",
      contacts: [
        { name: "Owen Marsh", title: "Site Superintendent", mobile: "(602) 555-7742", email: "omarsh@highrisebuilders.com", isPrimary: true },
      ],
      addresses: [],
    },
  ];

  const customerIdByName = new Map<string, number>();
  for (const spec of customerSpecs) {
    const [customer] = await db
      .insert(customersTable)
      .values({
        name: spec.name,
        phone: spec.phone,
        fax: spec.fax,
        email: spec.email,
        website: spec.website,
        billingAddress: spec.billingAddress,
        defaultDeliveryAddress: spec.defaultDeliveryAddress,
        industry: spec.industry,
        status: spec.status,
        notes: spec.notes,
      })
      .returning();
    customerIdByName.set(spec.name, customer.id);
    if (spec.contacts.length > 0) {
      await db.insert(contactsTable).values(
        spec.contacts.map((c) => ({
          customerId: customer.id,
          name: c.name,
          title: c.title ?? null,
          phone: "phone" in c ? (c.phone ?? null) : null,
          mobile: "mobile" in c ? ((c as { mobile?: string }).mobile ?? null) : null,
          fax: null,
          email: c.email ?? null,
          isPrimary: c.isPrimary,
        })),
      );
    }
    if (spec.addresses.length > 0) {
      await db.insert(customerAddressesTable).values(
        spec.addresses.map((a) => ({
          customerId: customer.id,
          label: a.label,
          address: a.address,
        })),
      );
    }
  }

  console.log("Seeding estimates...");
  const estimateRows = await db
    .insert(estimatesTable)
    .values([
      {
        bidNumber: "B-1001",
        name: "Warehouse Mezzanine Frame",
        customer: "Ironclad Logistics",
        status: "won",
        estimatedHours: 190,
        amount: 48500,
        bidDate: daysFromNow(-30),
        dueDate: daysFromNow(9),
        notes: "Won after revised pricing. Galvanized finish required.",
      },
      {
        bidNumber: "B-1002",
        name: "Stair & Handrail Package",
        customer: "Highrise Builders",
        status: "won",
        estimatedHours: 125,
        amount: 31200,
        bidDate: daysFromNow(-60),
        dueDate: daysFromNow(-10),
        notes: "Repeat customer.",
      },
      {
        bidNumber: "B-1003",
        name: "Storage Rack System",
        customer: "Grainway Mills",
        status: "submitted",
        estimatedHours: 96,
        amount: 22750,
        bidDate: daysFromNow(-5),
        dueDate: daysFromNow(45),
        notes: "Awaiting customer decision. Competing with two other shops.",
      },
      {
        bidNumber: "B-1004",
        name: "Catwalk & Access Platforms",
        customer: "Summit HVAC",
        status: "draft",
        estimatedHours: 60,
        amount: null,
        bidDate: null,
        dueDate: daysFromNow(60),
        notes: "Takeoff in progress from customer drawings.",
      },
      {
        bidNumber: "B-1005",
        name: "Equipment Skid Frames",
        customer: "Delta Processing",
        status: "lost",
        estimatedHours: 80,
        amount: 19800,
        bidDate: daysFromNow(-20),
        dueDate: null,
        notes: "Lost on price. Customer went with out-of-state fabricator.",
      },
    ])
    .returning();
  const estimateByBid = new Map(estimateRows.map((e) => [e.bidNumber, e]));

  console.log("Seeding jobs...");
  const jobSpecs = [
    {
      jobNumber: "J-2001",
      name: "Warehouse Mezzanine Frame",
      customer: "Ironclad Logistics",
      status: "active",
      dueDate: daysFromNow(9),
      notes: "Galvanized finish required. Customer inspection before shipping.",
      estimates: [12, 80, 60, 24, 8, 6],
      currentStageIndex: 1,
      fromBid: "B-1001",
    },
    {
      jobNumber: "J-2002",
      name: "Pedestrian Bridge Trusses",
      customer: "Metro Public Works",
      status: "active",
      dueDate: daysFromNow(-2),
      notes: "Priority job. Weld certs must be attached.",
      estimates: [16, 120, 100, 40, 16, 10],
      currentStageIndex: 2,
    },
    {
      jobNumber: "J-2003",
      name: "Rooftop Equipment Platform",
      customer: "Summit HVAC",
      status: "active",
      dueDate: daysFromNow(21),
      notes: null,
      estimates: [8, 40, 30, 16, 6, 4],
      currentStageIndex: 0,
    },
    {
      jobNumber: "J-2004",
      name: "Conveyor Support Structure",
      customer: "Grainway Mills",
      status: "on_hold",
      dueDate: daysFromNow(30),
      notes: "Waiting on customer approval of revised drawings.",
      estimates: [10, 60, 45, 20, 8, 6],
      currentStageIndex: 1,
    },
    {
      jobNumber: "J-2005",
      name: "Stair & Handrail Package",
      customer: "Highrise Builders",
      status: "complete",
      dueDate: daysFromNow(-10),
      notes: "Delivered and installed.",
      estimates: [6, 50, 40, 18, 6, 5],
      currentStageIndex: 6,
      fromBid: "B-1002",
    },
    {
      jobNumber: "SF-1055",
      name: "SCR Module Support Steel",
      customer: "GEA",
      status: "active",
      dueDate: daysFromNow(35),
      notes: "Ship to York facility. Paint spec: high-temp gray.",
      estimates: [14, 90, 70, 30, 12, 8],
      currentStageIndex: 0,
    },
    {
      jobNumber: "SF-1048",
      name: "Crusher Deck Platform",
      customer: "Freeport McMoran",
      status: "active",
      dueDate: daysFromNow(14),
      notes: "Deliver to Morenci Mine. MSHA compliance tags required.",
      estimates: [10, 70, 55, 22, 10, 8],
      currentStageIndex: 2,
    },
  ];

  for (const spec of jobSpecs) {
    const [job] = await db
      .insert(jobsTable)
      .values({
        jobNumber: spec.jobNumber,
        name: spec.name,
        customer: spec.customer,
        customerId: customerIdByName.get(spec.customer) ?? null,
        status: spec.status,
        dueDate: spec.dueDate,
        notes: spec.notes,
        estimateId: spec.fromBid
          ? (estimateByBid.get(spec.fromBid)?.id ?? null)
          : null,
      })
      .returning();

    const stageRows = await db
      .insert(stagesTable)
      .values(
        DEFAULT_STAGES.map((name, index) => ({
          jobId: job.id,
          name,
          estimatedHours: spec.estimates[index],
          orderIndex: index,
          status:
            index < spec.currentStageIndex
              ? "complete"
              : index === spec.currentStageIndex
                ? "in_progress"
                : "not_started",
        })),
      )
      .returning();

    for (let i = 0; i < spec.currentStageIndex && i < stageRows.length; i++) {
      const stage = stageRows[i];
      const emp = employees[i % employees.length];
      const worked = Math.max(1, Math.round(stage.estimatedHours * 0.9));
      await db.insert(timeEntriesTable).values({
        employeeId: emp.id,
        jobId: job.id,
        stageId: stage.id,
        clockIn: hoursAgo(worked + 24),
        clockOut: hoursAgo(24),
      });
    }
  }

  console.log("Adding a couple of live (clocked-in) punches...");
  const activeJobs = await db.select().from(jobsTable);
  const fabJob = activeJobs.find((j) => j.jobNumber === "J-2001");
  const bridgeJob = activeJobs.find((j) => j.jobNumber === "J-2002");
  if (fabJob) {
    const [stage] = await db
      .select()
      .from(stagesTable)
      .where(
        and(
          eq(stagesTable.jobId, fabJob.id),
          eq(stagesTable.status, "in_progress"),
        ),
      );
    if (stage) {
      await db.insert(timeEntriesTable).values({
        employeeId: employees[0].id,
        jobId: fabJob.id,
        stageId: stage.id,
        clockIn: hoursAgo(2),
      });
    }
  }
  if (bridgeJob) {
    const [stage] = await db
      .select()
      .from(stagesTable)
      .where(
        and(
          eq(stagesTable.jobId, bridgeJob.id),
          eq(stagesTable.status, "in_progress"),
        ),
      );
    if (stage) {
      await db.insert(timeEntriesTable).values({
        employeeId: employees[1].id,
        jobId: bridgeJob.id,
        stageId: stage.id,
        clockIn: hoursAgo(3),
      });
    }
  }

  console.log("Seed complete.");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
