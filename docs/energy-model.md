# Energy use and game speed zones

The HUD, road signs, traffic, police and cameras use `trafficSpeedLimit` as their
single source. Game arterial zones are 130 km/h on motorways, 110 on trunk roads,
90 on primary roads, and 70 on secondary roads. Motorway/trunk links use 80.
Local posted limits are retained. These raised arterial zones are gameplay
settings, rather than a reproduction of real legal limits.

Energy consumption uses measured longitudinal acceleration and road elevation,
vehicle mass, estimated rolling resistance, aerodynamic drag, drivetrain losses,
accessories and engine efficiency. It integrates litres or kWh in real time;
there is no accelerated tank drain. Petrol overrun cuts injection in gear but
neutral coasting retains idle flow. Engine warm-up and higher RPM add losses.
Sport modes add small efficiency losses, while their stronger acceleration
increases the actual power demand. UI consumption is smoothed over 0.6 seconds.

The i4 uses 81.1 kWh of usable battery energy. Regeneration is constrained by
braking work, conversion loss, low speed, battery state of charge and a 195 kW
ceiling. The tank/battery percentage survives model switches. Estimated range
uses a moving consumption estimate instead of jumping after one acceleration.

Capacities and reference consumption are anchored to BMW publications; mass,
drag and efficiency curves are simplified simulation parameters. The simulation
is not a certified WLTP test cycle or a prediction for an individual real car.

## Calibration references

- [BMW M3 technical data: 59 L and approximately 10.1–10.2 L/100 km combined](https://www.bmw.com.my/en/all-models/m-series/bmw-3-series-m-models/bmw-m3-sedan-technical-data.html)
- [BMW M4 CSL: 405 kW, 59 L, and approximately 9.9–10.1 L/100 km combined](https://www.press.bmwgroup.com/canada/article/detail/T0392133EN/the-new-bmw-m4-csl%3A-extreme-performance-with-motorsport-dna?language=en)
- [BMW M5 CS: approximately 10.9–11.3 L/100 km combined](https://newsroom.bmwgroup.com/global/the-new-bmw-m5-cs/)
- [BMW i4 M50 launch data: 81.1 kWh usable battery and 195 kW maximum recuperation](https://www.press.bmwgroup.com/usa/article/detail/T0334247EN_US/the-new-2022-bmw-i4-edrive40-and-i4-m50)
- [BMW i4 M50 WLTP reference: 18.0–22.5 kWh/100 km](https://www.press.bmwgroup.com/global/article/detail/T0333329EN/the-first-ever-bmw-i4?language=en)
- [US Department of Energy: 33.7 kWh per US gasoline gallon equivalent](https://www.energy.gov/cmei/vehicles/articles/fotw-1373-december-16-2024-efficiency-evs-model-year-2024-ranges-53-140-mpge)

A warm, level-road game simulation at 100 km/h produces about 9.6 L/100 km for
the M3 and 17.0 kWh/100 km for the i4. A combined driving cycle includes starts,
stops and acceleration, so these steady-cruise samples are not combined figures.
