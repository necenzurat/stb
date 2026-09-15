# Product

## Register

product

## Users

Bucharest riders using a phone on the street or at a stop, often one-handed, to see which line to catch next. They already know the city; they need live positions and waiting times, not a tour of the network.

## Product Purpose

An unofficial STB / InfoTB map: nearby stops, a line’s path, live vehicles, and arrivals at a tapped stop. Success is answering “what is coming, and when?” in a glance, without covering the map they are navigating.

## Brand Personality

Civic, glanceable, street-level. Precise like a destination display, not like a SaaS dashboard. Voice is short labels and times, no marketing.

## Anti-references

Google Maps place cards, generic Leaflet white balloons, glassmorphic HUD stacks, timetable PDFs, and asterisks that only make sense if you already know the legend. No side-stripe list rows. No internal stop ids in the UI.

## Design Principles

- The map stays the surface; overlays borrow as little of it as possible.
- Live data outranks chrome: route number, destination, next time.
- Transit vernacular: colored route bullets, destination, then time (like a stop display).
- Scheduled vs live is a word, never a footnote symbol.
- One-handed outdoor use: large hit targets, high contrast on the map, no hover-only meaning.

## Accessibility & Inclusion

Aim for WCAG 2.2 AA on overlays. Do not rely on line color alone (keep the route number). Visible focus on popup rows. Respect `prefers-reduced-motion`. Contrast ink on colored bullets by luminance.
