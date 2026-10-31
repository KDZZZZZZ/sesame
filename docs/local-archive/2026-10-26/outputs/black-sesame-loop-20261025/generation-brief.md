# Black sesame loop — generation brief

Status: blocked on image generation. The built-in tool failed with `connection failed: error sending request` on four attempts. The user chose to continue AI redrawing instead of local recoloring/upscaling. No generated artwork or completed animation exists yet.

Requirements:
- Keep the supplied hand-drawn style and 16:9 composition.
- Black sesame throughout, with restrained charcoal highlights.
- Target deliverables: 3840 × 2160 loop plus preview and keyframes.
- Exact final background: #FAFAFA.
- Small falling seeds pass behind the fixed mound; no visible landed seed vanishes on reset.
- Verify the seam and export resolution before claiming completion.

## Generation prompt

Use case: precise-object-edit / illustration-story.
Asset type: high-resolution layered animation source atlas.
Input image 1 is the edit target and composition/style reference.

Redraw this reference as a refined, high-resolution BLACK SESAME illustration. Output a 3840 x 2160 landscape PNG with a REAL TRANSPARENT alpha background (the final animation will composite it over exact #FAFAFA).
Keep the reference's charming hand-inked contour and softly painted shading, quiet centered composition, low mound, scattered ground seeds, and generous upper negative space. Keep the camera frontal with a slight view down at the mound. This must remain a hand-drawn illustration, not photography or 3D.

Replace EVERY ivory / cream / tan seed with convincing black sesame: small flattened elongated tapered ovals, subtly pointed tips, deep near-black and charcoal bodies, restrained cool graphite-gray edge highlights and delicate natural surface shading. No beige seeds, no white seeds, no large white highlight patches, no coffee beans, no stones. Keep individual seeds distinguishable, avoid one solid black mass. Crisp elegant outlines, fine clean detail, no blurry enlargement.

Precise atlas layout:
- The main black sesame mound and a few scattered seeds occupy the LOWER HALF ONLY, roughly x=650..3190, y=1120..1910 on the requested 3840x2160 canvas. The mound summit is near x=1920,y=1160, the foot near y=1810. The mound is broad and relatively low like the reference, about 5-6 average seed lengths tall, with many overlapping small seeds. Add a subtle neutral-gray grounding shadow only immediately beneath the pile and scattered seeds, with transparent edges.
- In the otherwise empty upper half, place exactly ONE isolated black sesame seed centered at x=1920,y=500. It is a small horizontal tapered oval, about 100 px long and 43 px wide at requested full resolution, with the identical hand-painted black material and ink style as the pile. This isolated seed is an animation sprite that will be moved and shrunk in compositing; do not connect it to the pile.
- Leave a completely transparent horizontal gap between this isolated seed and the mound, especially y=680..1000. Keep all artwork inset from canvas edges.

Remove all exclamation lines, speed lines, arcs, emphasis marks and any other graphic ornaments.
No background color baked into the art, no cream paper texture, no checkerboard drawn as pixels, no text, no labels, no panel borders, no watermark.
Deliver a single polished, full-resolution image, not a storyboard or multi-panel grid.

