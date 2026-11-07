// Location pages for search, worldwide: /inventory-reports (all areas) and /inventory-reports/<slug> for UK cities,
// towns and London boroughs, and cities in Ireland, the US (with state rules), Canada, Australia, New Zealand, the UAE
// and South Africa, each in its own country's words (move-in inspection, condition report, bond…). Each page is written for its place: the nation's own rules (deposit schemes and
// deadlines, tenancy wording, safety checks differ between England, Wales, Scotland and Northern Ireland), the
// nearest other areas, local questions and answers, and structured data (Service with areaServed, FAQPage,
// BreadcrumbList). The app works the same everywhere; nothing here claims a local office.
const fs = require('fs');
const path = require('path');
const PLACES = [
  // [slug, name, region, nation, lat, lon, kind]
  ['london', 'London', 'Greater London', 'england', 51.507, -0.128, 'city'],
  ['birmingham', 'Birmingham', 'West Midlands', 'england', 52.486, -1.890, 'city'],
  ['manchester', 'Manchester', 'Greater Manchester', 'england', 53.481, -2.242, 'city'],
  ['leeds', 'Leeds', 'West Yorkshire', 'england', 53.801, -1.549, 'city'],
  ['liverpool', 'Liverpool', 'Merseyside', 'england', 53.408, -2.992, 'city'],
  ['sheffield', 'Sheffield', 'South Yorkshire', 'england', 53.381, -1.470, 'city'],
  ['bristol', 'Bristol', 'South West England', 'england', 51.455, -2.588, 'city'],
  ['newcastle', 'Newcastle upon Tyne', 'Tyne and Wear', 'england', 54.978, -1.618, 'city'],
  ['nottingham', 'Nottingham', 'East Midlands', 'england', 52.954, -1.158, 'city'],
  ['leicester', 'Leicester', 'East Midlands', 'england', 52.637, -1.140, 'city'],
  ['coventry', 'Coventry', 'West Midlands', 'england', 52.407, -1.512, 'city'],
  ['bradford', 'Bradford', 'West Yorkshire', 'england', 53.796, -1.759, 'city'],
  ['southampton', 'Southampton', 'Hampshire', 'england', 50.909, -1.404, 'city'],
  ['portsmouth', 'Portsmouth', 'Hampshire', 'england', 50.819, -1.088, 'city'],
  ['brighton', 'Brighton and Hove', 'East Sussex', 'england', 50.822, -0.137, 'city'],
  ['reading', 'Reading', 'Berkshire', 'england', 51.454, -0.978, 'town'],
  ['oxford', 'Oxford', 'Oxfordshire', 'england', 51.752, -1.258, 'city'],
  ['cambridge', 'Cambridge', 'Cambridgeshire', 'england', 52.205, 0.122, 'city'],
  ['milton-keynes', 'Milton Keynes', 'Buckinghamshire', 'england', 52.041, -0.759, 'city'],
  ['norwich', 'Norwich', 'Norfolk', 'england', 52.630, 1.297, 'city'],
  ['york', 'York', 'North Yorkshire', 'england', 53.960, -1.087, 'city'],
  ['hull', 'Hull', 'East Yorkshire', 'england', 53.744, -0.332, 'city'],
  ['plymouth', 'Plymouth', 'Devon', 'england', 50.375, -4.143, 'city'],
  ['exeter', 'Exeter', 'Devon', 'england', 50.718, -3.534, 'city'],
  ['bath', 'Bath', 'Somerset', 'england', 51.381, -2.359, 'city'],
  ['stoke-on-trent', 'Stoke-on-Trent', 'Staffordshire', 'england', 53.003, -2.180, 'city'],
  ['derby', 'Derby', 'East Midlands', 'england', 52.922, -1.476, 'city'],
  ['wolverhampton', 'Wolverhampton', 'West Midlands', 'england', 52.587, -2.129, 'city'],
  ['sunderland', 'Sunderland', 'Tyne and Wear', 'england', 54.906, -1.381, 'city'],
  ['luton', 'Luton', 'Bedfordshire', 'england', 51.879, -0.418, 'town'],
  ['bournemouth', 'Bournemouth', 'Dorset', 'england', 50.720, -1.880, 'town'],
  ['canterbury', 'Canterbury', 'Kent', 'england', 51.280, 1.079, 'city'],
  ['cardiff', 'Cardiff', 'South Wales', 'wales', 51.481, -3.179, 'city'],
  ['swansea', 'Swansea', 'South Wales', 'wales', 51.621, -3.944, 'city'],
  ['newport', 'Newport', 'South Wales', 'wales', 51.588, -2.998, 'city'],
  ['edinburgh', 'Edinburgh', 'Lothian', 'scotland', 55.953, -3.188, 'city'],
  ['glasgow', 'Glasgow', 'Strathclyde', 'scotland', 55.864, -4.252, 'city'],
  ['aberdeen', 'Aberdeen', 'North East Scotland', 'scotland', 57.149, -2.094, 'city'],
  ['dundee', 'Dundee', 'Tayside', 'scotland', 56.462, -2.970, 'city'],
  ['belfast', 'Belfast', 'County Antrim', 'ni', 54.597, -5.930, 'city'],
  // London boroughs
  ['barking-and-dagenham', 'Barking and Dagenham', 'East London', 'england', 51.554, 0.134, 'borough'],
  ['barnet', 'Barnet', 'North London', 'england', 51.625, -0.152, 'borough'],
  ['bexley', 'Bexley', 'South East London', 'england', 51.441, 0.149, 'borough'],
  ['brent', 'Brent', 'North West London', 'england', 51.567, -0.271, 'borough'],
  ['bromley', 'Bromley', 'South East London', 'england', 51.406, 0.014, 'borough'],
  ['camden', 'Camden', 'North London', 'england', 51.529, -0.125, 'borough'],
  ['croydon', 'Croydon', 'South London', 'england', 51.372, -0.101, 'borough'],
  ['ealing', 'Ealing', 'West London', 'england', 51.513, -0.305, 'borough'],
  ['enfield', 'Enfield', 'North London', 'england', 51.652, -0.081, 'borough'],
  ['greenwich', 'Greenwich', 'South East London', 'england', 51.483, 0.006, 'borough'],
  ['hackney', 'Hackney', 'East London', 'england', 51.545, -0.055, 'borough'],
  ['hammersmith-and-fulham', 'Hammersmith and Fulham', 'West London', 'england', 51.493, -0.223, 'borough'],
  ['haringey', 'Haringey', 'North London', 'england', 51.590, -0.111, 'borough'],
  ['harrow', 'Harrow', 'North West London', 'england', 51.580, -0.334, 'borough'],
  ['havering', 'Havering', 'East London', 'england', 51.577, 0.212, 'borough'],
  ['hillingdon', 'Hillingdon', 'West London', 'england', 51.534, -0.476, 'borough'],
  ['hounslow', 'Hounslow', 'West London', 'england', 51.468, -0.361, 'borough'],
  ['islington', 'Islington', 'North London', 'england', 51.538, -0.103, 'borough'],
  ['kensington-and-chelsea', 'Kensington and Chelsea', 'West London', 'england', 51.499, -0.194, 'borough'],
  ['kingston-upon-thames', 'Kingston upon Thames', 'South West London', 'england', 51.412, -0.300, 'borough'],
  ['lambeth', 'Lambeth', 'South London', 'england', 51.460, -0.121, 'borough'],
  ['lewisham', 'Lewisham', 'South East London', 'england', 51.445, -0.021, 'borough'],
  ['merton', 'Merton', 'South West London', 'england', 51.410, -0.188, 'borough'],
  ['newham', 'Newham', 'East London', 'england', 51.525, 0.035, 'borough'],
  ['redbridge', 'Redbridge', 'East London', 'england', 51.559, 0.074, 'borough'],
  ['richmond-upon-thames', 'Richmond upon Thames', 'South West London', 'england', 51.461, -0.303, 'borough'],
  ['southwark', 'Southwark', 'South London', 'england', 51.503, -0.088, 'borough'],
  ['sutton', 'Sutton', 'South London', 'england', 51.361, -0.194, 'borough'],
  ['tower-hamlets', 'Tower Hamlets', 'East London', 'england', 51.520, -0.030, 'borough'],
  ['waltham-forest', 'Waltham Forest', 'East London', 'england', 51.588, -0.012, 'borough'],
  ['wandsworth', 'Wandsworth', 'South West London', 'england', 51.457, -0.193, 'borough'],
  ['westminster', 'Westminster', 'Central London', 'england', 51.497, -0.137, 'borough'],
  ['city-of-london', 'the City of London', 'Central London', 'england', 51.515, -0.093, 'borough'],
  // Ireland
  ['dublin', 'Dublin', 'Leinster', 'ie', 53.350, -6.260, 'city'],
  ['cork', 'Cork', 'Munster', 'ie', 51.898, -8.475, 'city'],
  ['galway', 'Galway', 'Connacht', 'ie', 53.271, -9.057, 'city'],
  // United States (state rules in STATES)
  ['new-york', 'New York', 'New York', 'us', 40.713, -74.006, 'city', 'ny'],
  ['los-angeles', 'Los Angeles', 'California', 'us', 34.052, -118.244, 'city', 'ca'],
  ['san-francisco', 'San Francisco', 'California', 'us', 37.775, -122.419, 'city', 'ca'],
  ['san-diego', 'San Diego', 'California', 'us', 32.716, -117.161, 'city', 'ca'],
  ['chicago', 'Chicago', 'Illinois', 'us', 41.878, -87.630, 'city', 'il'],
  ['houston', 'Houston', 'Texas', 'us', 29.760, -95.370, 'city', 'tx'],
  ['dallas', 'Dallas', 'Texas', 'us', 32.777, -96.797, 'city', 'tx'],
  ['austin', 'Austin', 'Texas', 'us', 30.267, -97.743, 'city', 'tx'],
  ['miami', 'Miami', 'Florida', 'us', 25.762, -80.192, 'city', 'fl'],
  ['orlando', 'Orlando', 'Florida', 'us', 28.538, -81.379, 'city', 'fl'],
  ['atlanta', 'Atlanta', 'Georgia', 'us', 33.749, -84.388, 'city', 'ga'],
  ['seattle', 'Seattle', 'Washington', 'us', 47.606, -122.332, 'city', 'wa'],
  ['boston-ma', 'Boston', 'Massachusetts', 'us', 42.360, -71.059, 'city', 'ma'],
  ['washington-dc', 'Washington, D.C.', 'District of Columbia', 'us', 38.907, -77.037, 'city', 'dc'],
  ['philadelphia', 'Philadelphia', 'Pennsylvania', 'us', 39.953, -75.165, 'city', 'pa'],
  ['phoenix', 'Phoenix', 'Arizona', 'us', 33.448, -112.074, 'city', 'az'],
  ['denver', 'Denver', 'Colorado', 'us', 39.739, -104.990, 'city', 'co'],
  ['detroit', 'Detroit', 'Michigan', 'us', 42.331, -83.046, 'city', 'mi'],
  ['richmond-va', 'Richmond', 'Virginia', 'us', 37.541, -77.436, 'city', 'va'],
  ['las-vegas', 'Las Vegas', 'Nevada', 'us', 36.170, -115.140, 'city', ''],
  ['nashville', 'Nashville', 'Tennessee', 'us', 36.163, -86.781, 'city', ''],
  ['charlotte', 'Charlotte', 'North Carolina', 'us', 35.227, -80.843, 'city', ''],
  ['portland', 'Portland', 'Oregon', 'us', 45.515, -122.679, 'city', ''],
  // The next biggest US cities, and the biggest in every state that had none (slugs end in the state code, so no UK place shares them)
  ['san-antonio-tx', 'San Antonio', 'Texas', 'us', 29.42, -98.49, 'city', ''],
  ['san-jose-ca', 'San Jose', 'California', 'us', 37.34, -121.89, 'city', ''],
  ['jacksonville-fl', 'Jacksonville', 'Florida', 'us', 30.33, -81.66, 'city', ''],
  ['fort-worth-tx', 'Fort Worth', 'Texas', 'us', 32.76, -97.33, 'city', ''],
  ['columbus-oh', 'Columbus', 'Ohio', 'us', 39.96, -83.00, 'city', ''],
  ['indianapolis-in', 'Indianapolis', 'Indiana', 'us', 39.77, -86.16, 'city', ''],
  ['el-paso-tx', 'El Paso', 'Texas', 'us', 31.76, -106.49, 'city', ''],
  ['oklahoma-city-ok', 'Oklahoma City', 'Oklahoma', 'us', 35.47, -97.52, 'city', ''],
  ['louisville-ky', 'Louisville', 'Kentucky', 'us', 38.25, -85.76, 'city', ''],
  ['memphis-tn', 'Memphis', 'Tennessee', 'us', 35.15, -90.05, 'city', ''],
  ['baltimore-md', 'Baltimore', 'Maryland', 'us', 39.29, -76.61, 'city', ''],
  ['milwaukee-wi', 'Milwaukee', 'Wisconsin', 'us', 43.04, -87.91, 'city', ''],
  ['albuquerque-nm', 'Albuquerque', 'New Mexico', 'us', 35.08, -106.65, 'city', ''],
  ['tucson-az', 'Tucson', 'Arizona', 'us', 32.22, -110.97, 'city', ''],
  ['fresno-ca', 'Fresno', 'California', 'us', 36.74, -119.79, 'city', ''],
  ['sacramento-ca', 'Sacramento', 'California', 'us', 38.58, -121.49, 'city', ''],
  ['mesa-az', 'Mesa', 'Arizona', 'us', 33.42, -111.83, 'city', ''],
  ['kansas-city-mo', 'Kansas City', 'Missouri', 'us', 39.10, -94.58, 'city', ''],
  ['colorado-springs-co', 'Colorado Springs', 'Colorado', 'us', 38.83, -104.82, 'city', ''],
  ['omaha-ne', 'Omaha', 'Nebraska', 'us', 41.26, -95.93, 'city', ''],
  ['raleigh-nc', 'Raleigh', 'North Carolina', 'us', 35.78, -78.64, 'city', ''],
  ['long-beach-ca', 'Long Beach', 'California', 'us', 33.77, -118.19, 'city', ''],
  ['virginia-beach-va', 'Virginia Beach', 'Virginia', 'us', 36.85, -75.98, 'city', ''],
  ['oakland-ca', 'Oakland', 'California', 'us', 37.80, -122.27, 'city', ''],
  ['minneapolis-mn', 'Minneapolis', 'Minnesota', 'us', 44.98, -93.27, 'city', ''],
  ['tulsa-ok', 'Tulsa', 'Oklahoma', 'us', 36.15, -95.99, 'city', ''],
  ['tampa-fl', 'Tampa', 'Florida', 'us', 27.95, -82.46, 'city', ''],
  ['arlington-tx', 'Arlington', 'Texas', 'us', 32.74, -97.11, 'city', ''],
  ['wichita-ks', 'Wichita', 'Kansas', 'us', 37.69, -97.34, 'city', ''],
  ['bakersfield-ca', 'Bakersfield', 'California', 'us', 35.37, -119.02, 'city', ''],
  ['aurora-co', 'Aurora', 'Colorado', 'us', 39.73, -104.83, 'city', ''],
  ['new-orleans-la', 'New Orleans', 'Louisiana', 'us', 29.95, -90.07, 'city', ''],
  ['cleveland-oh', 'Cleveland', 'Ohio', 'us', 41.50, -81.69, 'city', ''],
  ['anaheim-ca', 'Anaheim', 'California', 'us', 33.84, -117.91, 'city', ''],
  ['honolulu-hi', 'Honolulu', 'Hawaii', 'us', 21.31, -157.86, 'city', ''],
  ['henderson-nv', 'Henderson', 'Nevada', 'us', 36.04, -114.98, 'city', ''],
  ['stockton-ca', 'Stockton', 'California', 'us', 37.96, -121.29, 'city', ''],
  ['riverside-ca', 'Riverside', 'California', 'us', 33.95, -117.40, 'city', ''],
  ['lexington-ky', 'Lexington', 'Kentucky', 'us', 38.04, -84.50, 'city', ''],
  ['corpus-christi-tx', 'Corpus Christi', 'Texas', 'us', 27.80, -97.40, 'city', ''],
  ['irvine-ca', 'Irvine', 'California', 'us', 33.68, -117.83, 'city', ''],
  ['cincinnati-oh', 'Cincinnati', 'Ohio', 'us', 39.10, -84.51, 'city', ''],
  ['santa-ana-ca', 'Santa Ana', 'California', 'us', 33.75, -117.87, 'city', ''],
  ['newark-nj', 'Newark', 'New Jersey', 'us', 40.74, -74.17, 'city', ''],
  ['saint-paul-mn', 'Saint Paul', 'Minnesota', 'us', 44.95, -93.09, 'city', ''],
  ['pittsburgh-pa', 'Pittsburgh', 'Pennsylvania', 'us', 40.44, -80.00, 'city', ''],
  ['greensboro-nc', 'Greensboro', 'North Carolina', 'us', 36.07, -79.79, 'city', ''],
  ['lincoln-ne', 'Lincoln', 'Nebraska', 'us', 40.81, -96.70, 'city', ''],
  ['durham-nc', 'Durham', 'North Carolina', 'us', 35.99, -78.90, 'city', ''],
  ['plano-tx', 'Plano', 'Texas', 'us', 33.02, -96.70, 'city', ''],
  ['anchorage-ak', 'Anchorage', 'Alaska', 'us', 61.22, -149.90, 'city', ''],
  ['jersey-city-nj', 'Jersey City', 'New Jersey', 'us', 40.73, -74.08, 'city', ''],
  ['st-louis-mo', 'St. Louis', 'Missouri', 'us', 38.63, -90.20, 'city', ''],
  ['chandler-az', 'Chandler', 'Arizona', 'us', 33.31, -111.84, 'city', ''],
  ['north-las-vegas-nv', 'North Las Vegas', 'Nevada', 'us', 36.20, -115.12, 'city', ''],
  ['chula-vista-ca', 'Chula Vista', 'California', 'us', 32.64, -117.08, 'city', ''],
  ['buffalo-ny', 'Buffalo', 'New York', 'us', 42.89, -78.88, 'city', ''],
  ['gilbert-az', 'Gilbert', 'Arizona', 'us', 33.35, -111.79, 'city', ''],
  ['madison-wi', 'Madison', 'Wisconsin', 'us', 43.07, -89.40, 'city', ''],
  ['reno-nv', 'Reno', 'Nevada', 'us', 39.53, -119.81, 'city', ''],
  ['toledo-oh', 'Toledo', 'Ohio', 'us', 41.65, -83.54, 'city', ''],
  ['fort-wayne-in', 'Fort Wayne', 'Indiana', 'us', 41.08, -85.14, 'city', ''],
  ['lubbock-tx', 'Lubbock', 'Texas', 'us', 33.58, -101.86, 'city', ''],
  ['st-petersburg-fl', 'St. Petersburg', 'Florida', 'us', 27.77, -82.64, 'city', ''],
  ['laredo-tx', 'Laredo', 'Texas', 'us', 27.51, -99.51, 'city', ''],
  ['irving-tx', 'Irving', 'Texas', 'us', 32.81, -96.95, 'city', ''],
  ['chesapeake-va', 'Chesapeake', 'Virginia', 'us', 36.77, -76.29, 'city', ''],
  ['glendale-az', 'Glendale', 'Arizona', 'us', 33.54, -112.19, 'city', ''],
  ['winston-salem-nc', 'Winston-Salem', 'North Carolina', 'us', 36.10, -80.24, 'city', ''],
  ['port-st-lucie-fl', 'Port St. Lucie', 'Florida', 'us', 27.27, -80.35, 'city', ''],
  ['scottsdale-az', 'Scottsdale', 'Arizona', 'us', 33.49, -111.93, 'city', ''],
  ['garland-tx', 'Garland', 'Texas', 'us', 32.91, -96.64, 'city', ''],
  ['boise-id', 'Boise', 'Idaho', 'us', 43.62, -116.21, 'city', ''],
  ['norfolk-va', 'Norfolk', 'Virginia', 'us', 36.85, -76.29, 'city', ''],
  ['spokane-wa', 'Spokane', 'Washington', 'us', 47.66, -117.43, 'city', ''],
  ['fremont-ca', 'Fremont', 'California', 'us', 37.55, -121.99, 'city', ''],
  ['santa-clarita-ca', 'Santa Clarita', 'California', 'us', 34.39, -118.54, 'city', ''],
  ['san-bernardino-ca', 'San Bernardino', 'California', 'us', 34.11, -117.29, 'city', ''],
  ['tacoma-wa', 'Tacoma', 'Washington', 'us', 47.25, -122.44, 'city', ''],
  ['hialeah-fl', 'Hialeah', 'Florida', 'us', 25.86, -80.28, 'city', ''],
  ['baton-rouge-la', 'Baton Rouge', 'Louisiana', 'us', 30.45, -91.15, 'city', ''],
  ['modesto-ca', 'Modesto', 'California', 'us', 37.64, -120.99, 'city', ''],
  ['fontana-ca', 'Fontana', 'California', 'us', 34.09, -117.44, 'city', ''],
  ['mckinney-tx', 'McKinney', 'Texas', 'us', 33.20, -96.62, 'city', ''],
  ['moreno-valley-ca', 'Moreno Valley', 'California', 'us', 33.94, -117.23, 'city', ''],
  ['des-moines-ia', 'Des Moines', 'Iowa', 'us', 41.59, -93.62, 'city', ''],
  ['fayetteville-nc', 'Fayetteville', 'North Carolina', 'us', 35.05, -78.88, 'city', ''],
  ['salt-lake-city-ut', 'Salt Lake City', 'Utah', 'us', 40.76, -111.89, 'city', ''],
  ['yonkers-ny', 'Yonkers', 'New York', 'us', 40.93, -73.90, 'city', ''],
  ['worcester-ma', 'Worcester', 'Massachusetts', 'us', 42.26, -71.80, 'city', ''],
  ['rochester-ny', 'Rochester', 'New York', 'us', 43.16, -77.61, 'city', ''],
  ['sioux-falls-sd', 'Sioux Falls', 'South Dakota', 'us', 43.54, -96.73, 'city', ''],
  ['little-rock-ar', 'Little Rock', 'Arkansas', 'us', 34.75, -92.29, 'city', ''],
  ['amarillo-tx', 'Amarillo', 'Texas', 'us', 35.22, -101.83, 'city', ''],
  ['tallahassee-fl', 'Tallahassee', 'Florida', 'us', 30.44, -84.28, 'city', ''],
  ['grand-prairie-tx', 'Grand Prairie', 'Texas', 'us', 32.75, -97.00, 'city', ''],
  ['columbus-ga', 'Columbus', 'Georgia', 'us', 32.46, -84.99, 'city', ''],
  ['augusta-ga', 'Augusta', 'Georgia', 'us', 33.47, -81.97, 'city', ''],
  ['peoria-az', 'Peoria', 'Arizona', 'us', 33.58, -112.24, 'city', ''],
  ['oxnard-ca', 'Oxnard', 'California', 'us', 34.20, -119.18, 'city', ''],
  ['knoxville-tn', 'Knoxville', 'Tennessee', 'us', 35.96, -83.92, 'city', ''],
  ['overland-park-ks', 'Overland Park', 'Kansas', 'us', 38.98, -94.67, 'city', ''],
  ['birmingham-al', 'Birmingham', 'Alabama', 'us', 33.52, -86.80, 'city', ''],
  ['huntsville-al', 'Huntsville', 'Alabama', 'us', 34.73, -86.59, 'city', ''],
  ['montgomery-al', 'Montgomery', 'Alabama', 'us', 32.37, -86.30, 'city', ''],
  ['providence-ri', 'Providence', 'Rhode Island', 'us', 41.82, -71.41, 'city', ''],
  ['grand-rapids-mi', 'Grand Rapids', 'Michigan', 'us', 42.96, -85.67, 'city', ''],
  ['tempe-az', 'Tempe', 'Arizona', 'us', 33.43, -111.94, 'city', ''],
  ['chattanooga-tn', 'Chattanooga', 'Tennessee', 'us', 35.05, -85.31, 'city', ''],
  ['fort-lauderdale-fl', 'Fort Lauderdale', 'Florida', 'us', 26.12, -80.14, 'city', ''],
  ['akron-oh', 'Akron', 'Ohio', 'us', 41.08, -81.52, 'city', ''],
  ['jackson-ms', 'Jackson', 'Mississippi', 'us', 32.30, -90.18, 'city', ''],
  ['charleston-sc', 'Charleston', 'South Carolina', 'us', 32.78, -79.93, 'city', ''],
  ['cape-coral-fl', 'Cape Coral', 'Florida', 'us', 26.56, -81.95, 'city', ''],
  ['shreveport-la', 'Shreveport', 'Louisiana', 'us', 32.53, -93.75, 'city', ''],
  ['vancouver-wa', 'Vancouver', 'Washington', 'us', 45.64, -122.66, 'city', ''],
  ['frisco-tx', 'Frisco', 'Texas', 'us', 33.15, -96.82, 'city', ''],
  ['bridgeport-ct', 'Bridgeport', 'Connecticut', 'us', 41.19, -73.20, 'city', ''],
  ['manchester-nh', 'Manchester', 'New Hampshire', 'us', 42.99, -71.45, 'city', ''],
  ['burlington-vt', 'Burlington', 'Vermont', 'us', 44.48, -73.21, 'city', ''],
  ['portland-me', 'Portland', 'Maine', 'us', 43.66, -70.26, 'city', ''],
  ['wilmington-de', 'Wilmington', 'Delaware', 'us', 39.74, -75.55, 'city', ''],
  ['charleston-wv', 'Charleston', 'West Virginia', 'us', 38.35, -81.63, 'city', ''],
  ['billings-mt', 'Billings', 'Montana', 'us', 45.78, -108.50, 'city', ''],
  ['fargo-nd', 'Fargo', 'North Dakota', 'us', 46.88, -96.79, 'city', ''],
  ['cheyenne-wy', 'Cheyenne', 'Wyoming', 'us', 41.14, -104.82, 'city', ''],
  // Canada
  ['toronto', 'Toronto', 'Ontario', 'ca', 43.653, -79.383, 'city', 'on'],
  ['ottawa', 'Ottawa', 'Ontario', 'ca', 45.421, -75.697, 'city', 'on'],
  ['vancouver', 'Vancouver', 'British Columbia', 'ca', 49.283, -123.121, 'city', 'bc'],
  ['calgary', 'Calgary', 'Alberta', 'ca', 51.045, -114.072, 'city', 'ab'],
  ['edmonton', 'Edmonton', 'Alberta', 'ca', 53.546, -113.494, 'city', 'ab'],
  ['montreal', 'Montreal', 'Quebec', 'ca', 45.502, -73.567, 'city', ''],
  // Australia
  ['sydney', 'Sydney', 'New South Wales', 'au', -33.869, 151.209, 'city', 'nsw'],
  ['melbourne', 'Melbourne', 'Victoria', 'au', -37.814, 144.963, 'city', 'vic'],
  ['brisbane', 'Brisbane', 'Queensland', 'au', -27.470, 153.026, 'city', 'qld'],
  ['perth', 'Perth', 'Western Australia', 'au', -31.951, 115.861, 'city', 'wa-au'],
  ['adelaide', 'Adelaide', 'South Australia', 'au', -34.929, 138.601, 'city', ''],
  ['canberra', 'Canberra', 'Australian Capital Territory', 'au', -35.281, 149.130, 'city', ''],
  // New Zealand
  ['auckland', 'Auckland', 'North Island', 'nz', -36.848, 174.763, 'city'],
  ['wellington', 'Wellington', 'North Island', 'nz', -41.287, 174.776, 'city'],
  ['christchurch', 'Christchurch', 'South Island', 'nz', -43.532, 172.637, 'city'],
  // United Arab Emirates
  ['dubai', 'Dubai', 'Dubai', 'ae', 25.205, 55.271, 'city'],
  ['abu-dhabi', 'Abu Dhabi', 'Abu Dhabi', 'ae', 24.454, 54.377, 'city'],
  // South Africa
  ['cape-town', 'Cape Town', 'Western Cape', 'za', -33.925, 18.424, 'city'],
  ['johannesburg', 'Johannesburg', 'Gauteng', 'za', -26.204, 28.047, 'city'],
  ['durban', 'Durban', 'KwaZulu-Natal', 'za', -29.858, 31.022, 'city'],
].map(([slug, name, region, nation, lat, lon, kind, state]) => ({ slug, name, region, nation, lat, lon, kind, state: state || '' }));

// The rules that differ by nation. Kept general and factual; every page says to check current guidance.
const NATION = {
  england: { label: 'England', tenancy: 'assured shorthold tenancy (and, under the Renters’ Rights Act, periodic assured tenancies)', who: 'tenant',
    deposit: 'A tenancy deposit must be protected in a government-approved scheme (DPS, mydeposits or TDS) within 30 days of receiving it, and the tenant given the prescribed information.',
    disputes: 'At the end of the tenancy, the scheme’s free dispute service decides on the evidence, above all how the property was at check-in compared with check-out.',
    safety: 'Rented homes need a Gas Safety check every 12 months, an electrical safety inspection (EICR) at least every 5 years, and a valid EPC before they are let.' },
  wales: { label: 'Wales', tenancy: 'occupation contract under the Renting Homes (Wales) Act 2016', who: 'contract-holder',
    deposit: 'A deposit must be protected in an approved scheme (DPS, mydeposits or TDS) within 30 days of receiving it, with the prescribed information given to the contract-holder.',
    disputes: 'If you can’t agree on deductions, the scheme’s dispute service decides on the evidence, so a dated record of the condition at the start is what matters.',
    safety: 'Landlords must make sure the home is fit for human habitation, including an electrical safety check (EICR) at least every 5 years, an annual Gas Safety check and a valid EPC.' },
  scotland: { label: 'Scotland', tenancy: 'private residential tenancy', who: 'tenant',
    deposit: 'A deposit must be paid into an approved scheme (SafeDeposits Scotland, Letting Protection Service Scotland or mydeposits Scotland) within 30 working days of the tenancy starting.',
    disputes: 'The scheme’s free adjudication service decides disputed deductions on the evidence, so an inventory with dated photos at the start of the tenancy carries real weight.',
    safety: 'The repairing standard includes an electrical installation check (EICR) at least every 5 years, an annual Gas Safety check, working smoke and heat alarms, and a valid EPC.' },
  ni: { label: 'Northern Ireland', tenancy: 'private tenancy', who: 'tenant',
    deposit: 'A deposit must be protected in an approved scheme (such as TDS Northern Ireland or the Letting Protection Service Northern Ireland) within 28 days of receiving it, with the required information given to the tenant.',
    disputes: 'Disputed deductions can go to the scheme’s dispute resolution, which looks at the evidence of the condition at the start and end of the tenancy.',
    safety: 'Landlords need an annual Gas Safety check where there is gas, regular electrical safety checks, and a valid EPC when the property is let.' },
};

const UK = { uk: true, country: 'United Kingdom', report: 'inventory and check-in reports', thing: 'inventory', checkin: 'check-in', checkout: 'check-out', clerk: 'an inventory clerk', money: 'deposit',
  price: '£30 per report' };
['england', 'wales', 'scotland', 'ni'].forEach(k => { NATION[k] = Object.assign({}, UK, NATION[k]); NATION[k].basics = ['Most lets are a ' + NATION[k].tenancy + '.', NATION[k].deposit, NATION[k].safety]; });
// Outside the UK: the same app, in each country's own words. Prices are charged in pounds; the card converts.
const ABROAD = { uk: false, price: '£30 per report (charged in pounds; your card converts it)' };
Object.assign(NATION, {
  ie: Object.assign({}, ABROAD, { label: 'Ireland', country: 'Ireland', report: 'inventory and check-in reports', thing: 'inventory', checkin: 'check-in', checkout: 'check-out', clerk: 'an inventory clerk', money: 'deposit', who: 'tenant',
    disputes: 'Deposit disputes go to the Residential Tenancies Board (RTB), which decides on the evidence, so a dated record of the condition at the start of the tenancy matters.',
    basics: ['Most tenancies must be registered with the Residential Tenancies Board (RTB).', 'Landlords hold the deposit and must return it promptly at the end, less any justified deductions for damage beyond normal wear and tear or rent owed.', 'An inventory with dated photos, signed by both sides, is the best evidence if there is a dispute.'] }),
  us: Object.assign({}, ABROAD, { price: '{{USD}} per report (charged as £30 by card; your bank converts it)', label: 'the United States', country: 'United States', report: 'move-in and move-out inspection reports', thing: 'move-in inspection', checkin: 'move-in inspection', checkout: 'move-out inspection', clerk: 'an inspection company', money: 'security deposit', who: 'tenant',
    disputes: 'If you disagree about deductions from the security deposit, small claims courts look at the evidence: a move-in checklist with dated photos, signed by both sides, is what settles it.',
    basics: ['Security deposit rules are set by each state: how much can be taken, where it is held, and how many days the landlord has to return it with an itemized list of deductions.', 'Normal wear and tear can’t be deducted; damage beyond it can, so a record of the condition at move-in is essential.'] }),
  ca: Object.assign({}, ABROAD, { label: 'Canada', country: 'Canada', report: 'move-in and move-out condition inspection reports', thing: 'condition inspection', checkin: 'move-in inspection', checkout: 'move-out inspection', clerk: 'an inspection company', money: 'security deposit', who: 'tenant',
    disputes: 'Disputes over the deposit go to the province’s residential tenancy branch or board, which decides on the evidence of the condition at move-in and move-out.',
    basics: ['Residential tenancies are governed by each province’s own law, including the rules on security (damage) deposits.', 'Dated photos and a report signed by both sides at move-in and move-out are the evidence the tenancy boards look at.'] }),
  au: Object.assign({}, ABROAD, { label: 'Australia', country: 'Australia', report: 'rental condition reports', thing: 'condition report', checkin: 'ingoing condition report', checkout: 'outgoing condition report', clerk: 'a property manager', money: 'bond', who: 'renter',
    disputes: 'Bond disputes go to the state’s tribunal (such as NCAT, VCAT or QCAT), which relies on the condition report and photos from the start of the tenancy.',
    basics: ['Bonds are lodged with the state or territory’s bond authority, not kept by the landlord.', 'An ingoing condition report is a standard part of starting a tenancy, and dated photos make it far stronger.'] }),
  nz: Object.assign({}, ABROAD, { label: 'New Zealand', country: 'New Zealand', report: 'property inspection and condition reports', thing: 'property inspection report', checkin: 'move-in inspection', checkout: 'move-out inspection', clerk: 'a property manager', money: 'bond', who: 'tenant',
    disputes: 'Bond disputes go to the Tenancy Tribunal, which looks at evidence of the condition at the start and end of the tenancy.',
    basics: ['Bonds must be lodged with Tenancy Services, and they are refunded through them at the end of the tenancy.', 'A property inspection report with photos, signed at the start of the tenancy, is the recommended record of the condition.'] }),
  ae: Object.assign({}, ABROAD, { label: 'the UAE', country: 'United Arab Emirates', report: 'move-in and move-out inspection reports', thing: 'move-in inspection', checkin: 'move-in inspection', checkout: 'move-out inspection', clerk: 'a snagging or inspection company', money: 'security deposit', who: 'tenant',
    disputes: 'Disagreements about the security deposit can end up at the rental disputes centre, where photos and a signed condition report are the evidence that counts.',
    basics: ['Tenancy contracts are registered (Ejari in Dubai, Tawtheeq in Abu Dhabi).', 'A move-in inspection with dated photos, signed by both sides, protects the security deposit at move-out.'] }),
  za: Object.assign({}, ABROAD, { label: 'South Africa', country: 'South Africa', report: 'ingoing and outgoing inspection reports', thing: 'ingoing inspection', checkin: 'ingoing inspection', checkout: 'outgoing inspection', clerk: 'an inspection company', money: 'deposit', who: 'tenant',
    disputes: 'Deposit disputes can go to the Rental Housing Tribunal, which relies on the ingoing and outgoing inspections.',
    basics: ['The Rental Housing Act requires the landlord and tenant to inspect the property together at the start and end of the lease, to record any defects or damage.', 'The deposit is held in an interest-bearing account and refunded with interest, less the cost of any damage found at the outgoing inspection.'] }),
});
// US states and provinces with a rule worth knowing (general information; pages say to check current law).
const STATES = {
  ny: 'In New York, a security deposit is capped at one month’s rent, the landlord must offer an inspection before move-in, and the deposit must be returned with an itemized statement within 14 days of move-out.',
  ca: 'In California, the landlord must return the deposit, or give an itemized statement of deductions, within 21 days of move-out. Photos at move-in and move-out are now part of the expected evidence.',
  il: 'In Chicago, the Residential Landlord and Tenant Ordinance sets strict deposit rules, including a receipt and return of the deposit within 45 days of move-out.',
  tx: 'In Texas, the landlord must refund the deposit, with a written list of any deductions, within 30 days of the tenant moving out.',
  fl: 'In Florida, the landlord has 15 days to return the deposit, or 30 days to give written notice of a claim on it.',
  ga: 'In Georgia, the landlord must give the tenant a list of any existing damage before taking a security deposit, and the tenant can check and sign it.',
  wa: 'In Washington State, a landlord can only keep a deposit if there is a written checklist of the condition at move-in, signed by both landlord and tenant.',
  ma: 'In Massachusetts, a landlord who takes a security deposit must give the tenant a statement of the property’s condition within 10 days.',
  dc: 'In Washington, D.C., the landlord must return the deposit, or a written list of deductions, within 45 days of the tenancy ending.',
  pa: 'In Pennsylvania, the landlord has 30 days after move-out to return the deposit or give a written list of damages.',
  az: 'In Arizona, the landlord must give the tenant a move-in inspection form, and the tenant can note any damage on it.',
  co: 'In Colorado, the deposit must be returned within one month of move-out (up to 60 days if the lease says so), with a written statement of any deductions.',
  mi: 'In Michigan, the landlord must give the tenant two blank inventory checklists at move-in, to record the condition and return one signed copy.',
  va: 'In Virginia, the landlord must give the tenant a written move-in inspection report within 5 days of the tenancy starting.',
  on: 'In Ontario, a landlord can only take a rent deposit (for the last month), not a damage deposit, so a move-in condition record is the main protection against damage.',
  bc: 'In British Columbia, the Residential Tenancy Act requires a condition inspection report at move-in and move-out, done together; without one, the landlord can lose the right to claim against the deposit.',
  ab: 'In Alberta, landlords who take a security deposit must do a move-in and move-out inspection report with the tenant.',
  nsw: 'In New South Wales, a landlord or agent must give the renter a condition report at the start of the tenancy.',
  vic: 'In Victoria, the rental provider must give the renter a condition report before they move in.',
  qld: 'In Queensland, an Entry Condition Report (Form 1a) must be given to the tenant at the start of the tenancy.',
  'wa-au': 'In Western Australia, a property condition report must be given to the tenant within 7 days of moving in if a bond is taken.',
};

const R = d => d * Math.PI / 180;
const dist = (a, b) => { const x = R(b.lon - a.lon) * Math.cos(R((a.lat + b.lat) / 2)), y = R(b.lat - a.lat); return Math.sqrt(x * x + y * y) * 6371; };
const UKN = ['england', 'wales', 'scotland', 'ni'], same = (a, b) => UKN.includes(a.nation) ? UKN.includes(b.nation) : a.nation === b.nation;
const nearest = (p, n) => PLACES.filter(q => q !== p && same(p, q) && (p.kind === 'borough' ? true : q.kind !== 'borough' || q.slug === 'london')).map(q => [q, dist(p, q)]).sort((a, b) => a[1] - b[1]).slice(0, n).map(x => x[0]);

function mount(app, { renderPage, escHtml, REPORTS_DIR }){
  const e = escHtml;
  const BASE_PATH = '/inventory-reports';
  // Council areas in England with researched local data get a full hub of their own (areas.js), registered first.
  const hubs = require('./areas').mount(app, { renderPage, escHtml, PLACES, BASE_PATH, REPORTS_DIR });
  // The United States: /us, a page for every state with its security deposit law, and a move-in checklist: usa.js.
  const us = require('./usa').mount(app, { renderPage, escHtml, PLACES });
  const usState = p => p.nation === 'us' ? us.states.find(q => q.name === p.region) : null;
  const where = p => p.kind === 'borough' ? (p.slug === 'city-of-london' ? 'the City of London' : p.name + ', London') : p.name;
  // Local research for each city (content/cities/<slug>.json: neighbourhoods and their homes, the rental housing,
  // local rules with sources, where renters get help, what the climate means for an inspection, universities, a
  // local fact) and, for US cities, official figures from the Census Bureau fetched by the live server (uscensus.js).
  const LOCAL = {};
  try { fs.readdirSync(path.join(__dirname, 'content', 'cities')).filter(f => f.endsWith('.json')).forEach(f => { try { LOCAL[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(__dirname, 'content', 'cities', f), 'utf8')); } catch (err) { console.error('cities: ' + f + ': ' + err.message); } }); } catch (err) {}
  const census = require('./uscensus');
  census.start(REPORTS_DIR, PLACES.filter(p => p.nation === 'us' && usState(p)).map(p => ({ slug: p.slug, name: p.name, code: usState(p).code })));
  const okUrl = u => /^https?:\/\/[^\s"<>]+$/.test(String(u || ''));
  const usd = n => '$' + Number(n).toLocaleString('en-US');
  const pct = n => n + '%';

  function page(p){
    const N = NATION[p.nation], near = nearest(p, 6), w = where(p), place = p.name.replace(/^the /, '');
    const st = usState(p);
    const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
    const title = (N.uk ? 'DIY inventory and check-in reports' : cap(N.report)) + ' in ' + place;
    // UK: people search for an inventory clerk; the page answers that (do it yourself instead).
    const seoTitle = N.uk ? 'Inventory clerk in ' + place + '? Do your own inventory for £30' : st ? place + ', ' + st.code.toUpperCase() + ' Move-In & Move-Out Inspection App' : title + ' · £30';
    const low = t => t.charAt(0).toLowerCase() + t.slice(1), nd = t => String(t).replace(/\.$/, '');
    const usRule = st && st.returnDays ? 'In ' + st.name + ', the security deposit must be returned within ' + low(nd(st.returnDays).replace(/^within /i, '')) + (st.cap ? (/^No statewide/i.test(st.cap) ? ', and there is no statewide limit on its amount.' : ', and it can’t be more than ' + low(nd(st.cap)) + '.') : '.') : '';
    const stateRule = p.state && STATES[p.state] ? STATES[p.state] : usRule;
    // With local research, the national basics give way to the one rule for this state or nation (the rest is on /us/<state> or the guides).
    const basics = LOCAL[p.slug] && stateRule ? [stateRule] : N.basics.concat(stateRule ? [stateRule] : []);
    const faqs = [
      ['How much does ' + (N.uk ? 'an inventory report' : 'a ' + N.thing + ' report') + ' cost in ' + w + '?', 'With DIY Inventory it’s ' + N.price + ', whatever the size of the property: a ' + N.checkin + ', a ' + N.checkout + ' or an inspection during the tenancy. It’s free to start, and you pay when the finished report is downloaded.'],
      ...(N.uk ? [['How much does an inventory clerk cost in ' + w + '?', 'Inventory clerks in ' + w + ' usually charge for each visit, more for bigger or furnished homes, so a check-in and a check-out together can cost a few hundred pounds. With DIY Inventory each report is £30, whatever the size, and you can do it as soon as you have the keys.']] : []),
      ['Do I need ' + N.clerk + ' in ' + w + '?', 'No. You can do the ' + N.thing + ' yourself on your phone, or send your ' + N.who + ' a link to do it. The app gives every room a photo checklist, stamps the date and time on every photo, and both sides sign the report.'],
      ['Will the report help with a ' + N.money + ' dispute in ' + N.label + '?', N.disputes + ' Your report gives you that evidence: dated photos of every room, the condition of every item, meter readings and keys, signed by both sides.'],
    ].filter((f, i) => !LOCAL[p.slug] || (N.uk && i === 1));   // pages with local research keep only their own questions (UK: and what a clerk costs there)
    // ---- what makes this city's page its own
    const L = LOCAL[p.slug] || {}, C = p.nation === 'us' ? census.get(p.slug) : null, us_ = p.nation === 'us';
    const hood = us_ ? 'neighborhood' : 'neighbourhood';
    const hoods = (L.neighborhoods || []).filter(h => h && h.name).slice(0, 8);
    const rules = (L.localRules || []).filter(r => r && r.text);
    const help = (L.tenantHelp || []).filter(h => h && h.name && okUrl(h.url)).slice(0, 3);
    const tips = [];
    if (L.climate) tips.push(L.climate);
    if (C && C.built && C.built < 1978) tips.push('The typical home in ' + place + ' was built in ' + C.built + '. For homes built before 1978, federal law requires the landlord to disclose any known lead-based paint, so photograph peeling or chipped paint close up.');
    else if (C && C.built && C.built >= 1995) tips.push('Housing here is newer than in most US cities (the typical home was built in ' + C.built + '), so many items will be new or good at move-in: record that, so any damage later is easy to show.');
    if (C && C.homes && C.homes.houses >= 50) tips.push('More than half of renters here (' + C.homes.houses + '%) rent a house, so include the yard, fences, garage, gutters and the outside walls, not just the rooms.');
    else if (C && C.homes && C.homes.large >= 40) tips.push(C.homes.large + '% of renters here live in buildings of 20 or more apartments: photograph the mailbox and its key, parking or garage fobs, and any storage unit that comes with the apartment.');
    else if (C && C.homes && C.homes.small >= 40) tips.push(C.homes.small + '% of renters here live in duplexes and small apartment buildings: check shared entrances, stairs and laundry, and note which parts are yours to look after.');
    if (C && C.homes && C.homes.mobile >= 5) tips.push(C.homes.mobile + '% of renters here live in a mobile home: photograph the skirting, steps and underside as well as the inside.');
    if (C && C.burden >= 30) tips.push('Renters here typically spend ' + C.burden + '% of their income on rent, so the security deposit is a lot of money to lose: a dated record from move-in day is how you get it back.');
    const yr = C && C.year ? (C.year - 4) + '–' + C.year : '';
    const tiles = !C ? [] : [
      C.medRent && ['Median rent', usd(C.medRent) + ' a month'], C.r1 && ['1 bedroom', usd(C.r1)], C.r2 && ['2 bedrooms', usd(C.r2)], C.r3 && ['3 bedrooms', usd(C.r3)],
      C.rentedPct != null && ['Homes that are rented', pct(C.rentedPct)], C.burden && ['Rent as a share of income', pct(C.burden)], C.built && ['Typical home built', String(C.built)], C.pop && ['Population', C.pop.toLocaleString('en-US')],
    ].filter(Boolean);
    const extraFaqs = [];
    if (C && C.medRent) extraFaqs.push(['How much is rent in ' + place + '?', 'The median gross rent (rent plus any utilities the renter pays) in ' + place + ' is ' + usd(C.medRent) + ' a month' + (C.r1 && C.r2 && C.r3 ? ': ' + usd(C.r1) + ' for one bedroom, ' + usd(C.r2) + ' for two and ' + usd(C.r3) + ' for three' : '') + ', according to the U.S. Census Bureau’s American Community Survey (' + yr + ').' + (C.rentedPct != null ? ' About ' + C.rentedPct + '% of homes in ' + place + ' are rented.' : '')]);
    if (hoods.length >= 3) extraFaqs.push(['Which ' + place + ' ' + hood + 's do renters live in?', 'Popular areas include ' + hoods.slice(0, -1).map(h => h.name).join(', ') + ' and ' + hoods[hoods.length - 1].name + '. ' + (L.housing || '')]);
    if (help.length) extraFaqs.push([(us_ ? 'Where can renters in ' : 'Where can tenants in ') + place + ' get help?', help.map(h => h.name + (h.what ? ' (' + h.what + ')' : '')).join('; ') + '. If a deposit is disputed, your dated report is the evidence they will ask for.']);
    if (L.fact) extraFaqs.push(['What’s different about renting in ' + place + '?', L.fact]);
    const localHtml = (hoods.length || L.housing || L.fact) ? `<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">Local</span><h2>Renting in ${e(place)}</h2>${L.housing ? `<p>${e(L.housing)}</p>` : ''}</div>
  ${hoods.length ? `<div class="two">${hoods.map(h => `<div class="card" style="padding:14px 16px"><strong style="display:block">${e(h.name)}</strong>${h.homes ? `<span style="color:var(--ink-soft);font-size:14.5px">${e(h.homes.charAt(0).toUpperCase() + h.homes.slice(1))}</span>` : ''}</div>`).join('')}</div>` : ''}
  ${L.fact || (L.universities || []).length ? `<p style="margin:16px 0 0;text-align:center">${e(L.fact || '')}${(L.universities || []).length ? ' ' + e('Students rent near ' + L.universities.slice(0, 3).join(', ') + ', where leases often follow the academic year.') : ''}</p>` : ''}
</div></section>` : '';
    const numbersHtml = tiles.length ? `<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">In numbers</span><h2>${e(place)} rentals in numbers</h2><p>Official figures from the U.S. Census Bureau.</p></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">${tiles.map(([k, v]) => `<div class="card" style="padding:14px 16px;text-align:center"><span style="display:block;font-size:13.5px;color:var(--ink-soft)">${e(k)}</span><strong style="display:block;font-size:1.35rem;margin-top:4px">${e(v)}</strong></div>`).join('')}</div>
  ${C.homes ? `<p style="margin:14px 0 0;text-align:center">Where renters live: ${e(C.homes.houses + '% in houses, ' + C.homes.small + '% in buildings of 2 to 19 apartments, ' + C.homes.large + '% in buildings of 20 or more' + (C.homes.mobile ? ', ' + C.homes.mobile + '% in mobile homes' : '') + '.')}</p>` : ''}
  <p class="sub" style="margin:10px 0 0;font-size:13.5px;text-align:center">Source: <a href="https://data.census.gov/" rel="noopener">U.S. Census Bureau, American Community Survey ${e(yr)} 5-year estimates</a>${C.place ? ' (' + e(C.place) + ')' : ''}. Rents are median gross rent, including utilities paid by the renter.</p>
</div></section>` : '';
    const tipsHtml = tips.length ? `<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">Checklist</span><h2>What to check at ${e(us_ ? 'move-in' : N.checkin)} in ${e(place)}</h2><p>On top of the room-by-room checklist the app walks you through.</p></div>
  <div class="card"><ul>${tips.map(t => '<li>' + e(t) + '</li>').join('')}</ul></div>
</div></section>` : '';
    const rulesHtml = rules.length || help.length ? `<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">Rules and help</span><h2>Local rules and help in ${e(place)}</h2></div>
  <div class="two">
    ${rules.length ? `<div class="card"><h3>Local rules</h3><ul>${rules.map(r => '<li>' + e(r.text) + (okUrl(r.source) ? ` <a href="${e(r.source)}" rel="noopener nofollow">Source</a>` : '') + '</li>').join('')}</ul><p class="sub" style="margin:10px 0 0;font-size:13.5px">General information, not legal advice. Rules change, so check with the ${us_ ? 'city' : 'council or authority'}.</p></div>` : ''}
    ${help.length ? `<div class="card"><h3>${us_ ? 'Help for renters' : 'Help for tenants'}</h3><ul>${help.map(h => `<li><a href="${e(h.url)}" rel="noopener nofollow">${e(h.name)}</a>${h.what ? ': ' + e(h.what) : ''}</li>`).join('')}</ul></div>` : ''}
  </div>
</div></section>` : '';
    const sameRegion = us_ ? PLACES.filter(q => q !== p && q.nation === 'us' && q.region === p.region && !near.includes(q)).slice(0, 12) : [];
    faqs.push(...extraFaqs);
    const body = `<div class="page-head"><div class="wrap"><p style="margin:0 0 6px"><a href="${BASE_PATH}">← All areas</a></p><span class="kicker">${e(p.region)} · ${e(N.label.replace(/^the /, ''))}</span><h1>${e(title)}</h1><p>${LOCAL[p.slug] ? e(cap(N.checkin) + ' and ' + N.checkout + ' reports for ' + N.who + 's and landlords in ' + w + ', on your phone: dated photos, signed by both sides. ' + N.price + '.') : e(cap(N.checkin) + ' and ' + N.checkout + ' reports and inspections during the tenancy, for landlords, property managers and ' + N.who + 's in ' + w + ', done on your phone. Dated photos, every item’s condition, signed by both sides, and the PDF ready the moment it’s signed. ' + N.price + '.')}</p></div></div>
<section class="tight"><div class="wrap">
  <div class="two">
    ${LOCAL[p.slug] ? '' : `<div class="card"><h3>Why do it yourself in ${e(place)}?</h3><ul>
      <li>${e(N.uk ? '£30 a report instead of a clerk’s fee for every visit, ready the moment it’s signed.' : 'A fixed ' + (p.nation === 'us' ? '{{USD}}' : '£30') + ' a report instead of paying ' + N.clerk + ' for every visit, ready the moment it’s signed.')}</li>
      <li>The ${e(N.checkout)} starts from the ${e(N.checkin)} and shows what changed, photos side by side.${N.uk ? ' Prefer paper? Use our <a href="/inventory-template">free inventory template</a>.' : ''}</li>
    </ul></div>`}
    ${LOCAL[p.slug] && st ? `<div class="card" style="grid-column:1/-1;text-align:center"><a href="/us/${st.slug}">${e(p.region)} security deposit law: the limit, and how fast it must be returned →</a></div>` : `<div class="card"><h3>Renting in ${e(N.label)}: the basics</h3><ul>
      ${basics.map(b => '<li>' + e(b) + '</li>').join('\n      ')}
    </ul>${usState(p) ? `<p style="margin:10px 0 0"><a href="/us/${usState(p).slug}">${e(p.region)} security deposit law and move-in checklist →</a></p>` : ''}<p class="sub" style="margin:10px 0 0;font-size:13.5px">General information, not legal advice. Check the current rules for ${e(p.state ? p.region : N.label)}.</p></div>`}
  </div>
</div></section>
${localHtml}${numbersHtml}${tipsHtml}${rulesHtml}
<section style="padding-top:0"><div class="wrap"><div class="card" style="text-align:center"><p style="margin:0 0 12px">Add the property, photograph each room as the app walks you through it, sign, and the PDF report is ready. <a href="/how-it-works">How it works</a></p><p style="margin:0;display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><a class="btn primary" href="/app">Start free</a><a class="btn ghost" href="/example-report">See an example report</a></p></div></div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">Questions</span><h2>${e(cap(N.thing))}s in ${e(place)}: questions and answers</h2></div>
  <div class="faq">${faqs.map(([q, a]) => `<details><summary>${e(q)}</summary><p>${e(a)}</p></details>`).join('')}</div>
</div></section>
<section style="padding-top:0"><div class="wrap">
  <div class="sec-head"><span class="kicker">Nearby</span><h2>Also covering</h2></div>
  <p style="text-align:center;line-height:2.2">${near.map(q => `<a class="btn ghost sm" style="margin:0 4px" href="${BASE_PATH}/${q.slug}">${e(q.name.replace(/^the /, ''))}</a>`).join('')}<a class="btn ghost sm" style="margin:0 4px" href="${BASE_PATH}">All areas</a></p>
  ${sameRegion.length ? `<p style="text-align:center;line-height:2.2;margin-top:6px"><span class="sub">More in ${e(p.region)}:</span> ${sameRegion.map(q => `<a class="btn ghost sm" style="margin:0 4px" href="${BASE_PATH}/${q.slug}">${e(q.name)}</a>`).join('')}</p>` : ''}
</div></section>
<div class="final"><div class="wrap"><div class="card"><h2>Ready when you have the keys</h2><p>Start your ${e(place)} ${e(N.thing)} today, on your phone. It’s free until you download it.</p><a class="btn" href="/app">Start free</a></div></div></div>`;
    return { key: 'locations', lang: p.nation === 'us' ? 'en-US' : undefined, path: BASE_PATH + '/' + p.slug, title: st ? seoTitle : seoTitle + ' · DIY Inventory', og: N.uk ? seoTitle : title,
      desc: st ? 'Move-in and move-out inspections in ' + place + ', ' + st.code.toUpperCase() + ', for renters and landlords: dated photos of every room, signed PDF report. Free to start.' : 'Do your own ' + N.thing + ' and ' + N.checkout + ' report in ' + w + ' on your phone: dated photos, every item’s condition, signed by both sides, ready instantly. £30 per report, free to start.', body,
      jsonld: base => [
        { '@type': 'Service', name: cap(N.report) + ' in ' + place, serviceType: 'Property inventory and inspection report', provider: { '@id': base + '/#org' },
          areaServed: { '@type': p.kind === 'borough' ? 'AdministrativeArea' : 'City', name: place, containedInPlace: { '@type': 'Country', name: N.country } },
          offers: { '@type': 'Offer', price: '30.00', priceCurrency: 'GBP' } },
        { '@type': 'FAQPage', mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
        { '@type': 'BreadcrumbList', itemListElement: [['Home', '/'], ['Areas', BASE_PATH], [place, BASE_PATH + '/' + p.slug]].map(([name, u], i) => ({ '@type': 'ListItem', position: i + 1, name, item: base + u })) },
      ] };
  }

  const REGIONS = ['North East', 'North West', 'Yorkshire and The Humber', 'East Midlands', 'West Midlands', 'East of England', 'South East', 'South West'];
  function index(){
    const group = (title, list) => !list.length ? '' : `<div class="card" style="margin-bottom:16px"><h3 style="margin:0 0 10px">${e(title)}</h3><p style="margin:0;line-height:2.2">${list.map(p => `<a class="btn ghost sm" style="margin:0 6px 0 0" href="${BASE_PATH}/${p.slug}">${e(p.name.replace(/^the /, ''))}</a>`).join('')}</p></div>`;
    const by = k => PLACES.filter(k).sort((a, b) => a.name.replace(/^the /, '').localeCompare(b.name.replace(/^the /, '')));
    const body = `<div class="page-head"><div class="wrap"><span class="kicker">Worldwide</span><h1>Inventory and inspection reports, wherever you let</h1><p>DIY Inventory works anywhere in the world: do the check-in (or move-in inspection), inspections and check-out on your phone, for £30 a report. Pick your area for local information.</p></div></div>
<section class="tight"><div class="wrap">
${group('London boroughs', by(p => p.kind === 'borough'))}
${group('England', by(p => p.nation === 'england' && p.kind !== 'borough' && !hubs.slugs.includes(p.slug)))}
${REGIONS.map(r => [r, hubs.areas.filter(a => !a.london && a.region === r).sort((a, b) => a.name.localeCompare(b.name))]).filter(([r, l]) => l.length).map(([r, l]) => group(r, l)).join('\n')}
${group('Wales', by(p => p.nation === 'wales'))}
${group('Scotland', by(p => p.nation === 'scotland'))}
${group('Northern Ireland', by(p => p.nation === 'ni'))}
${group('Ireland', by(p => p.nation === 'ie'))}
<div class="card" style="margin-bottom:16px"><h3 style="margin:0 0 6px">United States</h3><p style="margin:0 0 10px"><a href="/us">Move-in and move-out inspections in all 50 states</a>, with each state’s security deposit law.</p><p style="margin:0;line-height:2.2">${us.states.map(q => `<a class="btn ghost sm" style="margin:0 6px 0 0" href="/us/${q.slug}">${e(q.name)}</a>`).join('')}</p></div>
${group('United States: cities', by(p => p.nation === 'us'))}
${group('Canada', by(p => p.nation === 'ca'))}
${group('Australia', by(p => p.nation === 'au'))}
${group('New Zealand', by(p => p.nation === 'nz'))}
${group('United Arab Emirates', by(p => p.nation === 'ae'))}
${group('South Africa', by(p => p.nation === 'za'))}
<p class="sub" style="text-align:center">Not listed? It works the same in every country. <a href="/app">Start free</a>.</p>
</div></section>`;
    return { key: 'locations', path: BASE_PATH, title: 'Inventory, move-in and condition reports worldwide · DIY Inventory', og: 'Inventory and inspection reports worldwide',
      desc: 'Do your own inventory, check-in, move-in inspection or condition report anywhere in the world, on your phone. £30 per report. UK, USA, Canada, Australia, New Zealand, Ireland, UAE and South Africa.', body,
      jsonld: base => [{ '@type': 'BreadcrumbList', itemListElement: [['Home', '/'], ['Areas', BASE_PATH]].map(([name, u], i) => ({ '@type': 'ListItem', position: i + 1, name, item: base + u })) }] };
  }

  const send = pg => (req, res) => res.type('html').send(renderPage(pg, req));
  app.get([BASE_PATH, BASE_PATH + '/'], send(index()));
  PLACES.filter(p => !hubs.slugs.includes(p.slug)).forEach(p => app.get([BASE_PATH + '/' + p.slug, BASE_PATH + '/' + p.slug + '/'], (req, res) => res.type('html').send(renderPage(page(p), req))));
  return { paths: [BASE_PATH].concat(PLACES.filter(p => !hubs.slugs.includes(p.slug)).map(p => BASE_PATH + '/' + p.slug), hubs.paths, us.paths), bodies: (hubs.bodies || []).concat(us.bodies) };
}

module.exports = { mount, PLACES };
