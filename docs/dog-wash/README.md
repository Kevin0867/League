# Ten-Bay Dog Wash — schematic design set

A self-serve dog wash in a 20'-0" × 50'-0" (1,000 SF) tenant shell.
**Issued for pricing and discussion. Not for construction.**

- `design-set.html` — the full drawing set: floor plan, bay section and elevation, water
  riser, hearing-range analysis, and an interactive 3D cutaway model. Published as an
  Artifact; the file is authored as an artifact fragment (no `<html>`/`<head>`/`<body>`
  wrapper — those are added at publish time).

Plan, sections and 3D model are all generated from a single geometry object (`G`) inside
the file, so no dimension can drift between drawings.

---

## Four findings that shaped the design

**1 — Twenty bays do not fit in 1,000 SF.**
A bay needs 7'-0" of depth (2'-6" tub + 4'-0" ramp run + 6" clearance) and the aisle needs
6'-0". That is the full 20'-0" width, so bays only run down the two long walls. After a
10'-0" front and a 14'-0" back of house, 26'-0" of wall length remains per side.
**Result: 8 elevated bays + 2 oversized walk-in bays = 10 stations.** A 20-station scaling
appendix is included so the phase-one plant is not stranded on expansion (~2,000–2,200 SF).

**2 — Parametric "cone of silence" speakers are contraindicated.**
They project a 40–60 kHz ultrasonic carrier at 120 dB+. Dogs hear to roughly 45 kHz
(Heffner, 1983), so the carrier is inside canine hearing — it would function as a
high-power dog deterrent over every dog. Active noise cancellation is no help either: it
works below ~500 Hz and only within ~1/10 wavelength of its error mic, while a bark is a
broadband 1–4 kHz transient.

**3 — What does work is passive, and it is shaped like the cone you imagined.**
A per-bay absorptive canopy at 7'-6" (NRC ≥ 0.95, 12" skirt) that doubles as the exhaust
hood, light housing and reel mount; **6'-0" solid dividers between bays** (4'-0" as briefed
leaves the bark path grazing the top — the extra two feet is worth 6–8 dB); the 4'-0"
picket fence and gate kept on the aisle side for supervision; a washable NRC ≥ 0.90
ceiling; and low-level masking. Modelled: 1,433 sabins → **RT60 0.41 s** (bare shell ≈ 3.2 s),
adjacent bark at the owner's ear **95 → 82 dBA (−13 dB, ≈ 60% quieter)**. Not silence.

**4 — Gas service is a go/no-go on the lease.**
450,500 BTU/hr at full simultaneity. With gas that is three wall-hung condensing units
(597 MBH installed). With electric resistance it is ~132 kW and a 400 A service.

---

## Program

| Zone | Depth | Area | Contains |
|---|---|---|---|
| A — Arrival | 10'-0" | 200 SF | Vestibule, 34" accessible transaction counter, retail, bench |
| B — Wash hall | 26'-0" | 520 SF | 8 elevated bays, 6'-0" aisle, 32'-0" centre trench drain |
| C — Back of house | 14'-0" | 280 SF | 2 XL walk-in bays, ADA restroom, storage/laundry, mechanical |

**Bays** — all 7'-0" deep. West wall: 2 large (6'-6") + 2 medium (6'-0").
East wall: 1 large + 1 medium + 2 small (5'-0"), plus a 3'-0" towel/supply alcove at the
entry end. XL1 and XL2 are 6'-6" × 6'-6" walk-in; **XL2 is the accessible wash station**
(no ramp, no rim, controls within 44" reach).

## Key dimensions

Everything hangs off the tub rim at **36" AFF** — standard counter height, as requested.

| | |
|---|---|
| Tub rim / working deck | 36" AFF |
| Tub interior floor | 16" AFF (20" interior depth) |
| Grate platform (dog stands on) | 18" AFF; small-dog riser insert to 26" |
| Ramp | 24" wide × 4'-0" run × 16" rise = 1:3 (18.4°), hinged at a gasketed tub door |
| Shampoo bank | 42" AFF, side partition, 4 shampoos + conditioner |
| Restraint loop | 42" AFF; secondary D-ring 48" AFF |
| Hot/cold mixing handles | 44" AFF, 105 °F mechanical stop |
| Dryer bracket + GFCI | 48" AFF, ≥12" horizontally clear of the rim |
| Aisle fence / gate | 48" high, 32" clear gate, latch at 40" AFF |
| Towel shelf (perforated 304 SS) | underside 60" AFF, 12" deep |
| Inter-bay divider | 72" high (6'-0"), solid acoustic core |
| Acoustic canopy | bottom 90" AFF, 6" deep, 12" skirt |
| Exhaust grille in canopy | 96" AFF, 175 CFM |
| Acoustic ceiling | 10'-0"; structure 14'-0" |

## Systems

**Domestic hot water.** 2.0 GPM per gun; hot fraction (100−55)/(140−55) = 0.529 →
1.06 GPM/station → 10.6 GPM at 100% simultaneity → **450,500 BTU/hr**. Three 199 MBH
condensing tankless on a cascade rack (597 MBH input, 13.3 GPM at 85 °F rise, N+1) plus a
119-gallon buffer tank. Store 140 °F, master-mix to 120 °F (ASSE 1017), per-bay mix
85–105 °F. 3/4" recirculation return with a bronze circulator. Twin softener above 7 gpg.

**Pressure.** Loss budget from meter to worst-case nozzle totals 63 PSI on top of the
40 PSI required at the nozzle = **103 PSI at the meter**; typical municipal residual is
55–70, so a duplex VFD booster (25 GPM @ 45 PSI boost) is required. The real fix for
"no pressure loss when everyone sprays" is a **2.0 GPM pressure-compensating cartridge in
every gun** — the booster holds the header, the cartridges guarantee equal flow. RPZ
backflow preventer at the service is mandatory (high-hazard cross-connection).

**Ceiling distribution** (as proposed — up the back wall, across the ceiling): 1-1/2" cold
header at 3.5 ft/s, 1-1/4" hot at 2.8 ft/s, stepping to 3/4"; 1/2" insulated drops with
quarter-turn isolation at each canopy. Trapeze at 6'-0" o.c. with a continuous drip pan,
water-sensing cable and a **normally-open motorised shut-off on the incoming service**.

**Drainage.** 2" tub wastes with strainer baskets; bay floors slope 1/4"/ft to the aisle;
aisle slopes both sides to a 6" stainless slot channel at 1/8"/ft; 4" building drain
(~37 DFU); trap primers throughout; **20 GPM hair and solids interceptor, emptied daily**.

**Dryer safety / fast-draining surface.** Five layers: elevated grate platform so the dog
stands above the water film; factory-pitched tub with no flat spots; urethane cement floor
at 1/4"/ft, DCOF ≥ 0.60 wet; wall-bracketed dryer that never touches the floor; Class A
GFCI (4–6 mA) at the breaker on a dedicated 20 A circuit per bay. Verify receptacle
locations against NEC 210.8(B) and 406.9(C) with the EE of record and the AHJ.

**Air and odour.** Canopy doubles as a capture hood — 175 CFM/bay, 250 CFM/XL bay,
**2,100 CFM total = 10.5 ACH**; 1,850 CFM tempered make-up so the space runs 250 CFM
negative. MERV-13 + potassium-permanganate-impregnated deep-bed carbon. Dehumidify to
≤ 55% RH (~97,000 BTU/hr latent from ten dryers). Nightly bio-enzymatic drain dosing.
**Scent-air in the lobby only** — many diffuser oils (tea tree, eucalyptus, pine, citrus,
cinnamon, peppermint, ylang-ylang) are toxic to dogs; the wash hall should be odour-neutral
by carbon and air change, not masked.

**Power.** 25.2 kW connected → 70 A at 208 V 3φ; specify a **200 A, 120/208 V, 3φ, 4W**
service for headroom to 20 bays. One dedicated 20 A GFCI circuit per bay. Class 2 24 VAC
only below the rim (foot switch + solenoid, 6-minute auto-off).

## Materials

| Element | Specify | Avoid |
|---|---|---|
| Floors, wet areas | Urethane cement, 1/4" troweled, quartz broadcast, 6" cove, DCOF ≥ 0.60 | Epoxy (delaminates under hot water), tile (grout fails) |
| Tubs | 16 ga 304 SS, #4, coved corners, integral deck, sound-deadened | Fibreglass |
| Bay walls to 8'-0" | 6 mm solid phenolic compact panel, silicone-sealed joints | FRP |
| Dividers | 1/2" HDPE / 1" mineral wool / 1 lb-sf loaded vinyl / 1/2" HDPE | Laminated MDF |
| Fence and gate | 316 SS or powder-coated aluminium, pickets 2-1/2" max clear | Galvanised steel |
| Ceiling | Perforated aluminium with encapsulated mineral wool, gasketed aluminium grid | Mineral fibre tile, steel grid |
| Hardware, wet zone | **316** stainless throughout | 304, zinc-plated |

## Confirm before design development

Gas meter capacity for 597 MBH · electrical service · measured static and residual water
pressure at 25 GPM · sewer authority on hair and shampoo discharge · exhaust discharge
location vs. neighbouring intakes · occupancy classification · animal establishment
licensing · ADA route, counter, restroom and XL2 as the accessible station.

Rough order of magnitude: **$580–855k** (±30%, US metro, existing shell). A
value-engineered version lands nearer $420k and gives up about 3 dB.
