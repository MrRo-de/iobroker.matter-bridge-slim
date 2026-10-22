# Matter Bridge Slim

Ein schlanker, lokal arbeitender Matter-Bridge-Adapter für ioBroker.

Matter Bridge Slim stellt konfigurierte ioBroker-Zustände einem
Matter-kompatiblen Controller bereit. Damit lassen sich unterstützte Geräte
über ein Matter-Ökosystem steuern oder überwachen.

**Projektstatus:** Frühe Entwicklungsphase. Kompatibilität und Verhalten
können abhängig vom Matter-Controller und den eingebundenen Geräten variieren.

## Funktionen

- Mehrere unabhängig konfigurierte Matter-Bridges.
- Konfigurierbare Bridge-Ports (Standard: `5540`).
- Gerätezuordnung über ioBroker-State-IDs.
- Unterstützte Gerätetypen:
  - Schalter
  - Dimmbare Lampe mit Helligkeitszustand
  - Temperatursensor
  - Sensor für relative Luftfeuchtigkeit
- Lokaler Betrieb ohne zwingend erforderlichen Cloud-Dienst.
- Anzeige der Pairing-Informationen in der Adapteradministration.

## Voraussetzungen

- Eine funktionierende ioBroker-Installation.
- Eine vom installierten ioBroker-Controller unterstützte Node.js-Version.
- Für die Entwicklung und den Build dieses Projekts wird Node.js 22 verwendet.
- Ein Matter-kompatibler Controller zum Anlernen und Steuern der Bridge.

Das Projekt wurde in einer Entwicklungsumgebung mit ioBroker 7.2.5 und
Admin 8.2.0 getestet. Daraus ergibt sich keine garantierte Kompatibilität mit
allen Versionen von ioBroker, Node.js, Betriebssystemen oder Matter-Controllern.

## Aus dem Quellcode bauen

```bash
npm install
npm run build
```

Der Build erzeugt die Adapter-Laufzeitdateien und die Administrationsdateien.

Ein installierbares Paket wird so erstellt:

```bash
npm pack
```

Installiere das erzeugte Paket auf einem Testsystem über das passende
ioBroker-Installationsverfahren für Adapter.

## Konfiguration

Lege in der Adapteradministration eine oder mehrere Bridges an. Jede Bridge
besitzt eine ID, einen Namen und einen Matter-Port. Füge anschließend Geräte
hinzu und wähle die passenden ioBroker-State-IDs aus.

Je nach Gerätetyp werden unterschiedliche Zustände benötigt:

- **Schalter:** ein Zustand für den Ein-/Aus-Wert.
- **Dimmbare Lampe:** ein Ein-/Aus-Zustand und ein Helligkeitszustand.
- **Temperatursensor:** ein Zustand mit Temperatur in Grad Celsius.
- **Luftfeuchtigkeitssensor:** ein Zustand mit relativer Luftfeuchtigkeit in Prozent.

Verwende gültige, vorhandene State-IDs und achte darauf, dass deren Werte
dem erwarteten Typ und Wertebereich entsprechen.

## Fehlerbehebung

- Prüfe, ob die Adapterinstanz läuft.
- Stelle sicher, dass jeder Bridge-Port frei ist.
- Prüfe, ob die konfigurierten State-IDs existieren und passende Werte liefern.
- Kontrolliere die ioBroker-Logs und den Pairing-Status des Matter-Controllers.
- Das Matter-Pairing hängt auch von Netzwerkerkennung und Controller-
  Kompatibilität ab. Ein laufender Adapter allein garantiert kein erfolgreiches Anlernen.

## Lizenz

Matter Bridge Slim wird unter der
[Non-Commercial License](LICENSE) bereitgestellt.

Kostenlose nichtkommerzielle Nutzung und kostenlose Weitergabe sind im
Rahmen der Lizenzbedingungen erlaubt. Kommerzielle Nutzung erfordert die
vorherige schriftliche Zustimmung des Copyright-Inhabers.
