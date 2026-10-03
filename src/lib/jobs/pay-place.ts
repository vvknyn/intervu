/**
 * Where a posting's pay currency is the national money: USD → the United
 * States, CAD → Canada, GBP → the UK, INR → India, EUR → the euro area.
 *
 * A remote posting that names no place in its title, place fields or
 * description, but pays in one country's money, is most likely for people in
 * that country: US pay laws make US employers post a USD range, and so on. It
 * is a likelihood, not a rule. Global employers also pay in USD or EUR, a
 * role open in the US and Canada often posts only its USD range, and a bare
 * "$" can be stored as USD. So the pay only counts when nothing else names a
 * place (`scoreLocation`'s `remote_pay_abroad`): it keeps the role from
 * reading as open to everyone and out of Today, and never hides it from a list.
 *
 * Isomorphic and pure.
 */
import { resumeCountriesFromLocation } from "./resume-location";

/** ISO 4217 code → ISO2 codes of the countries that use it as their own money. */
const CURRENCY_COUNTRIES: Readonly<Record<string, readonly string[]>> = {
    USD: ["US", "PR", "EC", "SV", "PA"],
    CAD: ["CA"],
    GBP: ["GB", "IM", "JE", "GG"],
    EUR: ["AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES", "AD", "MC", "SM", "ME", "XK"],
    INR: ["IN"],
    AUD: ["AU"],
    NZD: ["NZ"],
    CHF: ["CH", "LI"],
    SEK: ["SE"],
    NOK: ["NO"],
    DKK: ["DK"],
    ISK: ["IS"],
    PLN: ["PL"],
    CZK: ["CZ"],
    HUF: ["HU"],
    RON: ["RO"],
    BGN: ["BG"],
    UAH: ["UA"],
    TRY: ["TR"],
    ILS: ["IL"],
    AED: ["AE"],
    SAR: ["SA"],
    QAR: ["QA"],
    EGP: ["EG"],
    NGN: ["NG"],
    KES: ["KE"],
    ZAR: ["ZA"],
    JPY: ["JP"],
    CNY: ["CN"],
    HKD: ["HK"],
    TWD: ["TW"],
    KRW: ["KR"],
    SGD: ["SG"],
    MYR: ["MY"],
    IDR: ["ID"],
    THB: ["TH"],
    VND: ["VN"],
    PHP: ["PH"],
    PKR: ["PK"],
    BDT: ["BD"],
    MXN: ["MX"],
    BRL: ["BR"],
    ARS: ["AR"],
    CLP: ["CL"],
    COP: ["CO"],
    PEN: ["PE"],
};

/** What a person reads: "the United States", "the euro area". The first country names the rest. */
const CURRENCY_LABELS: Readonly<Record<string, string>> = { EUR: "the euro area" };

const REGION_NAMES =
    typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

const cache = new Map<string, PayPlace | null>();

export interface PayPlace {
    /** The currency as stored: "USD". */
    currency: string;
    /** Where it reads as likely: "the United States", "Canada", "the euro area". */
    label: string;
    /** Canonical country names, as `jobCountries` spells them. */
    countries: string[];
}

/** The countries whose own money `currency` is, or `null` for a currency this table doesn't know. */
export function payPlace(currency: string | null | undefined): PayPlace | null {
    const code = (currency ?? "").trim().toUpperCase();
    if (!code) return null;
    if (cache.has(code)) return cache.get(code)!;
    const countries = [
        ...new Set(
            (CURRENCY_COUNTRIES[code] ?? []).flatMap((iso2) => resumeCountriesFromLocation(REGION_NAMES?.of(iso2) ?? "").slice(0, 1)),
        ),
    ];
    const first = countries[0];
    const place =
        first == null
            ? null
            : { currency: code, label: CURRENCY_LABELS[code] ?? `${/^(united|netherlands|philippines)\b/i.test(first) ? "the " : ""}${first}`, countries };
    cache.set(code, place);
    return place;
}
