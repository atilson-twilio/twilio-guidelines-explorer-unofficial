// Saved views shown as buttons above the table. Edit freely: each view picks columns
// (ids from data.js — open the Columns picker and hover a column to see its id),
// optional filters ({ columnId: { s: [statuses], q: "text contains" } }), sort, and
// whether to limit the list to countries that have voice guidelines.
// Columns starting "wr." come from Twilio's Weather Report sheet (what Twilio sells today); put
// them next to the matching guideline column so disagreements (dashed outline) are easy to spot.
// The Weather Report is optional and never published, so views must also work without it: its
// columns, filters and sort are dropped automatically, `withoutWeatherReport` overrides any other
// field for that case, and `requiresWeatherReport: true` hides a view entirely.
//
// Statuses: yes, limited, notRequired, required, no, info, na, none

window.GUIDELINE_PRESETS = [
  {
    id: "overview",
    label: "Overview",
    description:
      "Headline SMS and voice capabilities for every country, with the Weather Report's view of what Twilio sells today next to the matching guideline. A dashed outline means the two disagree.",
    columns: [
      "sms.general.two-way-sms-supported",
      "sms.numbers.long-code-domestic.twilio-supported",
      "wr.numbers.sms-capable",
      "sms.numbers.long-code-international.twilio-supported",
      "sms.alpha.dynamic.twilio-supported",
      "sms.numbers.short-code.twilio-supported",
      "wr.shortcode.availability",
      "voice.reach.inbound.domestic",
      "voice.reach.outbound.international",
      "voice.callerid.outbound.international",
    ],
    withoutWeatherReport: { description: "Headline SMS and voice capabilities for every country." },
  },
  {
    id: "sms-intl",
    label: "SMS from out-of-country numbers",
    description:
      "Can you message this country from a non-local (international) long code, and is the sender number preserved? Compare with local long codes and alphanumeric sender IDs.",
    columns: [
      "sms.numbers.long-code-international.operator-network-capability",
      "sms.numbers.long-code-international.twilio-supported",
      "sms.numbers.long-code-international.sender-id-preserved",
      "sms.numbers.long-code-international.use-case-restrictions",
      "sms.numbers.long-code-international.best-practices",
      "sms.numbers.long-code-domestic.twilio-supported",
      "sms.alpha.dynamic.twilio-supported",
    ],
    sort: { id: "sms.numbers.long-code-international.twilio-supported", dir: "asc" },
  },
  {
    id: "voice-intl",
    label: "Voice from out-of-country numbers",
    description:
      "Outbound · International: can Twilio call phones in this country using a caller ID (From number) from another country, and is that caller ID shown? Check Outbound restrictions for caveats. Limited to the countries Twilio publishes voice guidelines for.",
    columns: [
      "voice.reach.outbound.international",
      "voice.reach.outbound.domestic",
      "voice.reach.outbound-restrictions",
      "voice.reach.outbound-requirements",
      "voice.callerid.outbound.international",
      "voice.callerid.outbound.domestic",
    ],
    voiceOnly: true,
  },
  {
    id: "alpha",
    label: "Alphanumeric sender ID",
    description:
      "Dynamic vs pre-registered alphanumeric sender IDs, provisioning time and restrictions, plus the Weather Report's current availability and fees.",
    columns: [
      "sms.alpha.dynamic.operator-network-capability",
      "sms.alpha.dynamic.twilio-supported",
      "wr.senderid.dynamic",
      "sms.alpha.dynamic.sender-id-preserved",
      "wr.senderid.pre-registered",
      "sms.alpha.pre-registration.twilio-supported",
      "sms.alpha.international-pre-registration.twilio-supported",
      "sms.alpha.domestic-pre-registration.twilio-supported",
      "sms.alpha.global-pre-registration.twilio-supported",
      "sms.alpha.international-pre-registration.provisioning-time",
      "sms.alpha.dynamic.use-case-restrictions",
    ],
    withoutWeatherReport: {
      description: "Dynamic vs pre-registered alphanumeric sender IDs, provisioning time and restrictions.",
    },
  },
  {
    id: "shortcode",
    label: "Short codes",
    description:
      "Where short codes are available and how long they take to provision. Sorted by the Weather Report, which is often more current than the guideline pages.",
    columns: [
      "wr.shortcode.availability",
      "sms.numbers.short-code.twilio-supported",
      "sms.numbers.short-code.operator-network-capability",
      "sms.numbers.short-code.provisioning-time",
      "sms.numbers.short-code.sender-id-preserved",
      "sms.numbers.short-code.use-case-restrictions",
    ],
    sort: { id: "wr.shortcode.availability", dir: "asc" },
    withoutWeatherReport: {
      description: "Where short codes are available and how long they take to provision.",
      sort: { id: "sms.numbers.short-code.twilio-supported", dir: "asc" },
    },
  },
  {
    id: "numbers",
    label: "Phone numbers",
    description:
      "Which number types Twilio sells in each country today, and at what list price, from the Weather Report. Click a cell for capabilities, expected delivery and address requirements.",
    columns: [
      "wr.numbers.sms-capable",
      "wr.numbers.local.availability",
      "wr.numbers.local.list-price",
      "wr.numbers.mobile.availability",
      "wr.numbers.mobile.list-price",
      "wr.numbers.national.availability",
      "wr.numbers.national.list-price",
      "wr.numbers.toll-free.availability",
      "wr.numbers.toll-free.list-price",
      "wr.numbers.other-types",
    ],
    filters: { "wr.numbers.sms-capable": { s: ["yes", "limited", "no"] } },
    requiresWeatherReport: true,
  },
  {
    id: "porting",
    label: "Number porting",
    description:
      "Porting numbers into Twilio: status by number type from the Weather Report, plus Twilio's porting guidelines (28 countries) on what's portable, what's needed and how long it takes. Click a cell for the porting guideline page and FAQ.",
    columns: [
      "wr.porting.best",
      "wr.porting.local",
      "wr.porting.mobile",
      "wr.porting.national",
      "wr.porting.toll-free",
      "porting.guidelines.portable-numbers",
      "porting.guidelines.timeframe",
      "porting.guidelines.required-information",
    ],
    filters: { "wr.porting.best": { s: ["yes", "limited", "no"] } },
    requiresWeatherReport: true,
  },
  {
    id: "porting-guide",
    label: "Porting requirements",
    description:
      "Twilio's porting guidelines in full, for the countries that have them: portable numbers, restrictions, documents, timeframe and how to submit. Click a cell for the porting guideline page and FAQ.",
    columns: [
      "porting.guidelines.portable-numbers",
      "porting.guidelines.restrictions",
      "porting.guidelines.required-information",
      "porting.guidelines.timeframe",
      "porting.guidelines.other-details",
      "porting.guidelines.how-to-submit",
      "porting.guidelines.regulatory-bodies",
    ],
    filters: { "porting.guidelines.portable-numbers": { s: ["info"] } },
  },
  {
    id: "sources",
    label: "Guidelines vs Weather Report",
    description:
      "Countries where the guideline pages and the Weather Report disagree on short codes, dynamic alphanumeric sender ID or SMS long codes. Where they disagree, the guideline column shows the Weather Report's answer (marked “per Weather Report”); click it for the guideline page's original text.",
    columns: [
      "wr.check.disagreements",
      "sms.numbers.short-code.twilio-supported",
      "wr.shortcode.availability",
      "sms.alpha.dynamic.twilio-supported",
      "wr.senderid.dynamic",
      "sms.numbers.long-code-domestic.twilio-supported",
      "wr.numbers.sms-capable",
    ],
    filters: { "wr.check.disagreements": { s: ["info"] } },
    requiresWeatherReport: true,
  },
  {
    id: "sms-features",
    label: "SMS features",
    description: "Two-way messaging, MMS, concatenation, portability and landline handling.",
    columns: [
      "sms.general.two-way-sms-supported",
      "sms.general.twilio-mms-support",
      "sms.general.twilio-concatenated-message-support",
      "sms.general.number-portability-available",
      "wr.porting.best",
      "sms.general.sending-sms-to-landline-numbers",
    ],
  },
  {
    id: "voice",
    label: "Voice capabilities",
    description: "Inbound/outbound reachability, caller ID handling, DTMF and emergency calling.",
    columns: [
      "voice.reach.inbound.domestic",
      "voice.reach.outbound.domestic",
      "voice.reach.inbound.international",
      "voice.reach.outbound.international",
      "voice.reach.inbound.toll-free",
      "voice.reach.outbound.toll-free",
      "voice.callerid.inbound.international",
      "voice.callerid.outbound.international",
      "voice.dtmf.outbound.rfc-2833-format",
      "voice.emergency.outbound.emergency-services",
    ],
    voiceOnly: true,
  },
  {
    id: "compliance",
    label: "Compliance notes",
    description: "The free-text compliance and restriction notes, for reading or searching.",
    columns: ["sms.general.compliance-considerations", "voice.reach.outbound-restrictions"],
  },
];
