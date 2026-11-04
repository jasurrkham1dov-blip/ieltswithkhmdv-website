// Sample content used only in DEMO MODE (when config.js has no Supabase keys).
const T1 = 'demo-test-bees', T2 = 'demo-test-bicycle', T3 = 'demo-test-listening';

export function DEMO_SEED() {
  const now = Date.now();
  const iso = ms => new Date(ms).toISOString();
  return {
    session: null,
    users: [
      { id: 'u-teacher', email: 'teacher@demo.uz', password: 'demo123' },
      { id: 'u-student', email: 'student@demo.uz', password: 'demo123' },
    ],
    profiles: [
      { id: 'u-teacher', email: 'teacher@demo.uz', full_name: 'Jasur (teacher)', telegram: '@ieltswithkhmdv', is_admin: true, created_at: iso(now - 864e5 * 30) },
      { id: 'u-student', email: 'student@demo.uz', full_name: 'Demo Student', telegram: '@demo_student', is_admin: false, created_at: iso(now - 864e5 * 3) },
    ],
    tests: [
      {
        id: T1, title: 'The Rise of Urban Beekeeping', kind: 'reading', duration_min: 20, visibility: 'practice',
        audio_url: '', strict_audio: false, question_count: 14, created_at: iso(now - 864e5), updated_at: iso(now - 864e5),
        content: { parts: [{
          title: 'Reading Passage 1',
          passage: `# The Rise of Urban Beekeeping

[A] For most of the twentieth century, beekeeping was regarded as a rural pursuit. Hives were found on farms and in orchards, where bees could feed on large fields of a single crop. In the last two decades, however, the number of hives kept in cities has risen sharply. In London alone, registered colonies more than doubled between 2008 and 2018, and similar growth has been recorded in Paris, New York and Melbourne.

[B] Several factors lie behind this trend. Media coverage of falling bee populations encouraged many city dwellers to believe that keeping a hive was a simple way to help the environment. Beekeeping courses, once offered mainly by agricultural colleges, began to appear in community centres, and equipment became widely available online. In 2010, New York lifted a long-standing ban on keeping honeybees within the city limits, which led to a wave of rooftop hives.

[C] Urban bees often do surprisingly well. Parks, private gardens, railway embankments and tree-lined streets provide a varied diet over a long flowering season, and cities are usually a few degrees warmer than the surrounding countryside. Honey from city hives is frequently more complex in flavour than honey from a single crop, and some beekeepers report higher yields per hive than their rural counterparts. Pesticide use in town gardens is also generally lower than on intensive farms.

[D] Yet ecologists have begun to question whether the boom is entirely positive. Honeybees are only one of hundreds of bee species, and most wild bees are solitary insects that nest in the ground or in hollow stems. When too many hives are placed in a small area, honeybees may compete with these wild species for nectar and pollen. A study of 14 Parisian sites found that wild bee visits to flowers declined as hive density increased. There are also concerns that diseases can spread more easily between closely packed colonies.

[E] Some researchers argue that the energy behind urban beekeeping would be better directed towards planting. A city with more flowering trees, wildflower verges and green roofs supports all pollinators, not only the domesticated honeybee. Several councils now advise residents who want to help bees to start with their gardens rather than buying a hive, and a number of beekeeping associations have begun to discourage new members from setting up colonies in neighbourhoods that already have many hives.`,
          groups: [
            { type: 'tfng', from: 1, instructions: 'Do the following statements agree with the information given in the passage? Choose **TRUE**, **FALSE** or **NOT GIVEN**.',
              body: `Until recently, most hives were kept in the countryside.
The number of hives in Paris doubled between 2008 and 2018.
Beekeeping courses are now offered only by agricultural colleges.
Most beekeepers in New York keep their hives on rooftops.` },
            { type: 'gap', from: 5, instructions: 'Complete the notes below. Choose **ONE WORD ONLY** from the passage for each answer.',
              body: `## Why bees do well in cities
- food comes from parks, gardens, railway embankments and [[5]] streets
- cities are slightly [[6]] than the countryside
- city honey often has a more complex [[7]]
- gardens have less [[8]] than intensive farms` },
            { type: 'mcq', from: 9, instructions: 'Choose the correct letter, **A**, **B**, **C** or **D**.',
              body: `What did the study of Parisian sites show?
A Honeybees produced less honey in crowded areas.
B Wild bees visited flowers less often where there were more hives.
C Diseases spread quickly between rooftop colonies.
D Solitary bees nested close to beehives.

What do several councils now advise residents?
A to register their hives with the council
B to buy hives only from approved suppliers
C to improve their gardens before getting a hive
D to join a local beekeeping association` },
            { type: 'multi', from: 11, picks: 2, instructions: 'Choose **TWO** letters, **A–E**.',
              body: `Which TWO reasons for the growth of urban beekeeping are mentioned in the passage?
A government payments to new beekeepers
B news reports about declining bee numbers
C the easy availability of equipment
D lower prices for honey
E a rise in the number of city parks` },
            { type: 'matching', from: 13, instructions: 'Which paragraph contains the following information? Choose the correct letter, **A–E**.',
              body: `a change in a city's regulations
a comparison of honey production in different places`, options: 'A\nB\nC\nD\nE' },
          ],
        }] },
      },
      {
        id: T2, title: 'The Story of the Bicycle', kind: 'reading', duration_min: 20, visibility: 'mock',
        audio_url: '', strict_audio: false, question_count: 8, created_at: iso(now - 864e5), updated_at: iso(now - 864e5),
        content: { parts: [{
          title: 'Reading Passage 1',
          passage: `# The Story of the Bicycle

[A] The first machine recognised as a forerunner of the bicycle was built in 1817 by Karl Drais, a German civil servant. Known as the 'running machine', it had two wheels in line and a steerable front wheel, but no pedals: riders pushed themselves along with their feet. It enjoyed a brief fashion among wealthy young men before being banned from pavements in several cities.

[B] Pedals arrived in the 1860s, when French makers attached cranks directly to the front wheel. Because each turn of the pedals produced only one turn of the wheel, makers soon enlarged the front wheel to increase speed. The result was the 'high-wheeler', whose front wheel could exceed 1.5 metres in diameter. Riding one required skill and courage, and falls were common.

[C] The modern shape appeared in 1885 with the 'safety bicycle' designed by John Kemp Starley. It had two wheels of similar size and a chain that drove the rear wheel. Three years later, the pneumatic tyre made riding far more comfortable. Sales grew rapidly, and by the late 1890s bicycles had become affordable for many working people.

[D] The bicycle had social effects that went far beyond transport. It gave women a new degree of independence and contributed to changes in women's clothing. In rural areas, it widened the distance young people could travel to find work or a partner.`,
          groups: [
            { type: 'matching', from: 1, instructions: 'Which paragraph contains the following information? Choose the correct letter, **A–D**.',
              body: `an explanation of why a wheel became larger
a reference to the bicycle becoming cheaper
a mention of a ban
an effect on what people wore`, options: 'A\nB\nC\nD' },
            { type: 'gap', from: 5, instructions: 'Complete the summary below. Choose **ONE WORD ONLY** from the passage for each answer.',
              body: `The first pedals were fixed to the [[5]] wheel. Riders of the high-wheeler often suffered [[6]]. Starley's design used a [[7]] to turn the back wheel, and the new tyre greatly improved rider [[8]].` },
          ],
        }] },
      },
      {
        id: T3, title: 'Sports Club Enquiry (sample, no audio)', kind: 'listening', duration_min: 10, visibility: 'practice',
        audio_url: '', strict_audio: false, question_count: 6, created_at: iso(now - 864e5 * 2), updated_at: iso(now - 864e5 * 2),
        content: { parts: [{
          title: 'Part 1',
          transcript: `**RECEPTIONIST:** Good morning, Riverside Sports Club.
**ANNA:** Hi, I'd like to join the club. My name's Anna Kowalski — that's K-O-W-A-L-S-K-I.
**RECEPTIONIST:** Thanks. And which activity are you mainly interested in?
**ANNA:** Swimming, mostly. My doctor told me it would help my back.
**RECEPTIONIST:** We have full membership or off-peak membership, which is cheaper.
**ANNA:** I work in the evenings, so off-peak would suit me.
**RECEPTIONIST:** That's £32 a month. Would you like to come and look around first?
**ANNA:** Yes — could I come on Saturday morning?`,
          groups: [
            { type: 'gap', from: 1, instructions: 'Complete the form below. Write **ONE WORD AND/OR A NUMBER** for each answer.',
              body: `## Riverside Sports Club — enquiry form
- Name: Anna [[1]]
- Main activity: [[2]]
- Membership type: [[3]]
- Monthly fee: £[[4]]` },
            { type: 'mcq', from: 5, instructions: 'Choose the correct letter, **A**, **B** or **C**.',
              body: `Why does Anna want to join?
A to meet new people
B because her doctor advised it
C to train for a competition

When will Anna visit the club?
A on Saturday morning
B on Saturday afternoon
C on Sunday morning` },
          ],
        }] },
      },
    ],
    keys: {
      [T1]: { 1: ['true'], 2: ['not given'], 3: ['false'], 4: ['not given'], 5: ['tree-lined', 'tree lined'], 6: ['warmer'], 7: ['flavour', 'flavor'], 8: ['pesticide', 'pesticides'], 9: ['b'], 10: ['c'], 11: ['b', 'c'], 12: ['b', 'c'], 13: ['b'], 14: ['c'] },
      [T2]: { 1: ['b'], 2: ['c'], 3: ['a'], 4: ['d'], 5: ['front'], 6: ['falls'], 7: ['chain'], 8: ['comfort'] },
      [T3]: { 1: ['kowalski'], 2: ['swimming'], 3: ['off-peak', 'off peak'], 4: ['32'], 5: ['b'], 6: ['a'] },
    },
    mocks: [
      { id: 'demo-mock-1', title: 'Sunday Mock #1', starts_at: iso(now - 36e5), ends_at: iso(now + 864e5 * 7), test_ids: [T2], results_released: false, created_at: iso(now) },
    ],
    secrets: { 'demo-mock-1': 'sunday' },
    attempts: [],
  };
}
