# AD-17 Add Dependabot, npm audit and CodeQL as a complement to SonarCloud - Wynik analizy

## Szczegóły zadania

| Pole | Wartość |
| --- | --- |
| Jira ID | GitHub Issue #22 / AD-17 |
| Tytuł | AD-17 Add Dependabot, npm audit and CodeQL as a complement to SonarCloud |
| Opis | Dodać warstwę security scanning uzupełniającą SonarCloud: Dependabot dla zależności npm, bramkę `npm audit` w CI oraz CodeQL dla JavaScript/TypeScript. |
| Priorytet | Wysoki (`priority:high`) |
| Zgłaszający | Finfinder |
| Data utworzenia | 2026-05-31T17:09:12Z |
| Termin realizacji | Brak daty; milestone `1.0 Stabilizacja MVP` |
| Etykiety | `priority:high`, `roadmap`, `security` |
| Szacowany nakład pracy | Średni: konfiguracja trzech mechanizmów bezpieczeństwa, dokumentacja polityki i walidacja CI |
| Złożoność analizy rozwiązań | Nie dotyczy - technologie wskazane w zadaniu; wykonano weryfikację dokumentacji oficjalnej, bez osobnego researchu wyboru rozwiązania |

## Wpływ biznesowy

Zadanie wzmacnia gotowość AgentDeck do stabilizacji MVP przez dodanie kontroli ryzyk, których obecna integracja SonarCloud nie pokrywa w pełni. SonarCloud zapewnia quality gate, część reguł SAST i metryki jakości, ale nie zastępuje Software Composition Analysis dla zależności npm ani natywnego GitHub code scanning przez CodeQL.

Po wdrożeniu zespół powinien szybciej wykrywać podatne pakiety, otrzymywać automatyczne PR-y aktualizacyjne i mieć drugi, niezależny kanał detekcji problemów bezpieczeństwa w kodzie TypeScript/JavaScript. Jest to istotne dla desktopowego IDE uruchamiającego lokalne usługi, IPC, przyszłe integracje MCP i agent runtime, gdzie regresje dependency/security mogą bezpośrednio wpływać na zaufanie do narzędzia.

## Zebrane informacje

### Baza wiedzy i narzędzia do zarządzania zadaniami

Źródłem wymagań jest GitHub Issue #22 w repozytorium `Finfinder/AgentDeck`. Issue jest otwarte, bez przypisanego assignee i bez komentarzy. Milestone `1.0 Stabilizacja MVP` opisuje hardening, dokumentację, quality gates, wydajność i gotowość do pierwszego użycia produkcyjnego.

Zakres z issue obejmuje:

- konfigurację `.github/dependabot.yml` dla npm z tygodniowym harmonogramem,
- dodanie kroku lub joba CI uruchamiającego `npm ci --ignore-scripts` oraz `npm audit --audit-level=moderate --json`,
- dodanie `.github/workflows/codeql.yml` dla JavaScript/TypeScript z domyślnymi pakietami CodeQL,
- udokumentowanie polityki remediacji w `SECURITY.md` albo `docs/`,
- zdefiniowanie etykiet i triage rules dla PR-ów Dependabota, np. `dependabot`, `security`, `priority:high`.

Doprecyzowanie od interesariusza: przyjąć konserwatywną politykę bezpieczeństwa. `npm audit` ma blokować od poziomu `moderate`, Dependabot PR-y nie mają auto-merge i wymagają review.

### Baza kodu

AgentDeck jest monorepo npm workspaces dla Electron + React + TypeScript. Root `package.json` ma skrypty `typecheck`, `lint`, `test`, `test:coverage`, `test:architecture` i `build`, a `package-lock.json` istnieje, więc `npm ci` i `npm audit` mogą działać deterministycznie na lockfile.

Aktualnie istnieje jedna konfiguracja GitHub Actions: `.github/workflows/sonar.yml`. Workflow działa na push i PR do `main` oraz branchy semver `*.*.*`, ma `permissions: {}` na poziomie workflow i minimalne uprawnienia joba. Używa `npm ci --ignore-scripts`, uruchamia typecheck, lint, coverage, test architektury i build, a następnie wysyła analizę do SonarCloud z `sonar.qualitygate.wait=true`.

`sonar-project.properties` jest skonfigurowany dla `Finfinder_AgentDeck`, źródeł `apps,packages`, testów `tests` i coverage LCOV w `coverage/lcov.info`. README zawiera sekcję Code Quality dla SonarCloud, SonarQube for IDE i opcjonalnego SonarQube MCP Server, ale nie opisuje jeszcze Dependabota, `npm audit`, CodeQL ani polityki remediacji podatności.

Nie znaleziono obecnie:

- `.github/dependabot.yml`,
- `.github/workflows/codeql.yml`,
- `SECURITY.md`,
- skryptu `npm audit` w `package.json`,
- osobnego workflow CI poza `sonar.yml`.

Repozytorium ma `docs/domain.md` z kontraktem domenowym i `.dependency-cruiser.cjs` jako egzekucję granic architektury. Zmiana AD-17 dotyczy governance repozytorium, CI i dokumentacji bezpieczeństwa, a nie modelu domenowego.

Bieżący baseline `npm audit` został potwierdzony po researchu: `npm audit --audit-level=moderate --json` zwrócił exit code `0` i `0` podatności (`info=0`, `low=0`, `moderate=0`, `high=0`, `critical=0`, `total=0`) przy 399 zależnościach, w tym 386 dev dependencies i 14 production dependencies. Oznacza to, że konserwatywna bramka od `moderate` nie powinna zablokować repo w momencie wdrożenia AD-17.

### Powiązane linki

- [https://github.com/Finfinder/AgentDeck/issues/22](https://github.com/Finfinder/AgentDeck/issues/22) - źródłowy GitHub Issue AD-17.
- [https://api.github.com/repos/Finfinder/AgentDeck/issues/22](https://api.github.com/repos/Finfinder/AgentDeck/issues/22) - metadane issue, etykiety i milestone.
- [https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file) - oficjalna referencja `dependabot.yml`; wymagane klucze to `version`, `updates`, `package-ecosystem`, `directory`/`directories` i `schedule.interval`.
- [https://docs.npmjs.com/cli/v11/commands/npm-audit/](https://docs.npmjs.com/cli/v11/commands/npm-audit/) - oficjalna dokumentacja `npm audit`; `--audit-level=moderate` ustawia minimalny próg niezerowego exit code i nie filtruje raportu JSON.
- [https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning-with-codeql](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning-with-codeql) - opis CodeQL i obsługi `javascript-typescript`.
- [https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication) - zasada minimalnych uprawnień dla `GITHUB_TOKEN` w workflow.
- [https://docs.github.com/en/code-security/code-scanning/troubleshooting-code-scanning/resource-not-accessible](https://docs.github.com/en/code-security/code-scanning/troubleshooting-code-scanning/resource-not-accessible) - ryzyko `403 Resource not accessible by integration` przy CodeQL i PR-ach Dependabota; istotne dla doboru triggerów i permissions.
- [https://sonarcloud.io/summary/new_code?id=Finfinder_AgentDeck](https://sonarcloud.io/summary/new_code?id=Finfinder_AgentDeck) - istniejący projekt SonarCloud wskazany w README.

### Analiza rozwiązań

Nie przeprowadzono - wymagania jednoznaczne, technologia wybrana. Zamiast porównania alternatyw zweryfikowano oficjalną dokumentację GitHub Dependabot, npm audit, CodeQL i `GITHUB_TOKEN`, aby doprecyzować ograniczenia oraz ryzyka wdrożenia.

Rekomendacja modularyzacyjna dla kolejnego kroku: `modularization: use-existing-domain`. Uzasadnienie: `docs/domain.md` już definiuje granice AgentDeck, a AD-17 nie wprowadza nowego bounded context, własności danych, agregatów ani zależności między modułami aplikacji. Zadanie powinno być planowane jako security/CI hardening w istniejącej strukturze repozytorium.

## Aktualny stan implementacji

### Istniejące komponenty

- SonarCloud workflow - `.github/workflows/sonar.yml` - można ponownie użyć jako wzorca triggerów, minimalnych permissions, `npm ci --ignore-scripts` i walidacji przed skanem.
- Konfiguracja SonarCloud - `sonar-project.properties` - można ponownie użyć jako kontekst dla tego, co CodeQL ma uzupełniać, a nie dublować.
- Skrypty walidacyjne npm - `package.json` - wymagają rozszerzenia o jawny kontekst audytu albo wykorzystania bez zmian w workflow.
- Lockfile zależności - `package-lock.json` - można ponownie użyć jako deterministyczną podstawę `npm ci` i `npm audit`.
- Dokumentacja jakości - `README.md` - wymaga rozszerzenia albo uzupełnienia przez `SECURITY.md`/`docs/` o politykę Dependabot, audit gate i CodeQL review.
- Kontrakt domenowy - `docs/domain.md` - można ponownie użyć do potwierdzenia, że zadanie nie wymaga nowej modularyzacji aplikacji.
- Issue seed - `.github/issue-seed.json` - zawiera wpis AD-17 i potwierdza etykiety `roadmap`, `priority:high`, `security`.

### Kluczowe pliki i katalogi

- `.github/workflows/` - katalog istniejącego workflow SonarCloud oraz docelowe miejsce dla CodeQL i ewentualnego audit joba, jeśli nie zostanie włączony do istniejącego workflow.
- `.github/dependabot.yml` - docelowy plik konfiguracji Dependabota; obecnie nie istnieje.
- `SECURITY.md` - preferowane root-level miejsce polityki bezpieczeństwa i remediacji; obecnie nie istnieje.
- `docs/` - alternatywne miejsce dokumentacji polityki, jeśli zespół zdecyduje się nie tworzyć root `SECURITY.md`.
- `package.json` - źródło manifestu npm, workspace scripts i zależności.
- `package-lock.json` - lockfile wymagany do stabilnego `npm audit` i aktualizacji przez Dependabota.
- `README.md` - istniejąca dokumentacja SonarCloud i jakości kodu, którą warto spiąć odsyłaczem do nowej polityki security.
- `docs/domain.md` - istniejący kontrakt modułów i zależności, istotny dla decyzji `use-existing-domain`.

## Analiza luk

Wszelkie brakujące informacje i luki w opisie zadania wraz z udzielonymi odpowiedziami.

### Pytanie 1

#### Czy `npm audit` ma blokować CI, czy tylko raportować wynik?

Przyjęto konserwatywną politykę: `npm audit --audit-level=moderate --json` ma blokować CI od poziomu `moderate`. Bieżący baseline audytu został potwierdzony jako czysty (`0` podatności, exit code `0`), ale przyszłe advisory npm nadal mogą natychmiast blokować PR-y.

### Pytanie 2

#### Czy Dependabot PR-y mogą być automatycznie mergowane?

Nie. Przyjęto brak auto-merge. PR-y Dependabota wymagają review człowieka i zielonych checks. Dokumentacja powinna jasno opisać, że aktualizacje security/high/critical mają wyższy priorytet triage, ale nadal przechodzą review.

### Pytanie 3

#### Jakie etykiety mają być użyte dla Dependabot PR-ów?

Repo ma już etykiety `security` i `priority:high`; issue sugeruje także `dependabot`. Nie potwierdzono, że etykieta `dependabot` istnieje. GitHub Dependabot ignoruje custom labels, które nie istnieją w repozytorium, więc plan powinien objąć utworzenie etykiety `dependabot` albo świadomą decyzję użycia tylko istniejących etykiet.

### Pytanie 4

#### Czy Dependabot ma obejmować tylko npm, czy również GitHub Actions?

Zakres issue jednoznacznie wymaga npm. Dokumentacja GitHub obsługuje również `github-actions`, a repo ma pinned actions w `sonar.yml`, więc rozszerzenie na GitHub Actions jest sensowne jako opcja przyszła lub dodatkowy element planu, ale nie jest wymagane do DoD AD-17.

### Pytanie 5

#### Gdzie umieścić `npm audit`: w istniejącym SonarCloud workflow czy osobnym workflow CI?

Repo obecnie ma tylko `.github/workflows/sonar.yml`; nie ma osobnego `ci.yml`. Issue mówi o CI, nie wskazuje konkretnego pliku. Dla spójności z obecnym pipeline można wykorzystać istniejący workflow albo wydzielić osobny security workflow. Decyzja należy do planu implementacji; research wskazuje tylko, że trigger branches powinny pozostać zgodne z `main` i semver `*.*.*`.

### Pytanie 6

#### Jakie uprawnienia powinien mieć CodeQL workflow?

Zgodnie z zasadą least privilege workflow powinien utrzymać `permissions: {}` na poziomie globalnym i nadać jobowi tylko wymagane scopes. Code scanning zwykle potrzebuje `security-events: write` oraz `contents: read`; dla PR-ów Dependabota trzeba uwzględnić znane ryzyko `403 Resource not accessible by integration` i używać triggerów rekomendowanych przez GitHub, zwłaszcza `pull_request` dla gałęzi Dependabota.

### Pytanie 7

#### Czy zadanie wymaga uruchomienia `/modularise` przed planowaniem?

Nie. Rekomendacja: `modularization: use-existing-domain`. Istniejący `docs/domain.md` i reguły architektoniczne są wystarczające, a zmiana nie dotyka bounded contexts ani kontraktów między modułami aplikacji.
