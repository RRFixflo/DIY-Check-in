# Research brief: local facts for city pages (a move-in / move-out inspection app for renters and landlords)

For EACH city in your list file, write facts that make that city's page genuinely local and useful to renters and
landlords there. Write ONE JSON array to the output file named in your task (use the Write tool; edit nothing else).

Rules: everything must be true and specific to that city. Prefer what you can confirm with a web search; well-known
facts you are sure of (e.g. a city's best-known neighborhoods) are fine without a search. NEVER invent: if unsure,
use null or []. No numbers for rents or prices (those come from official data elsewhere). Plain English, short
sentences, no marketing words. US cities in American English (neighborhood, apartment); UK, Ireland, Australia,
New Zealand and South Africa in British English (neighbourhood, flat). Budget: about 40 web searches in total, so
search for the local rules and tenant help, and rely on your knowledge for neighborhoods and housing.

Each element:
{
 "slug": "san-antonio-tx",                 // exactly as in your list
 "name": "San Antonio",
 "neighborhoods": [ {"name": "Alamo Heights", "homes": "older single-family homes and small apartment buildings"} ],  // 6 to 8 well-known residential areas renters actually live in; "homes" = the typical rental housing there, a short phrase
 "housing": "One or two sentences on the city's rental housing stock: what kinds of homes people rent and anything typical (e.g. 'Boston's rentals are largely triple-deckers and brick row houses').",
 "localRules": [ {"text": "One sentence on a city or county rule beyond state law that matters at move-in or move-out (deposit limits or interest, receipts, rental registration or inspection programs, move-in checklist ordinances, local deposit protection).", "source": "URL found in search results"} ],   // [] if none confirmed
 "tenantHelp": [ {"name": "Organization", "url": "https://...", "what": "short phrase: e.g. free legal advice for renters"} ],   // 1 to 3 real organizations serving renters in that city (city housing office, legal aid, tenant union, government tenancy service); URLs only as seen in search results
 "climate": "One sentence: what the local climate means for a move-in inspection, i.e. what to photograph or test (e.g. 'Test the air conditioning and photograph the outdoor unit; summer highs make a broken AC an urgent repair').",
 "universities": ["UTSA"],                 // major universities if student renting is notable, else []
 "fact": "One distinctive, true sentence about renting in this city (e.g. 'Most Boston leases start on September 1, so move-in day is the busiest of the year').",
 "unsure": "anything you could not confirm, or null"
}

Your final message: one short line saying how many cities were written and which fields you were unsure of.
