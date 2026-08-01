/**
 * Expand jee-ncert-chapter-reference.json:
 * - all JEE Main Mathematics units
 * - hard_archetypes / banned_easy_templates / hard_techniques on every chapter
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(
    __dirname,
    "..",
    "files",
    "ncert-reference",
    "mathematics",
    "jee-ncert-chapter-reference.json"
);

const hardExtras = (hardArchetypes, bannedEasy, hardTechniques) => ({
    hard_archetypes: hardArchetypes,
    banned_easy_templates: bannedEasy,
    hard_techniques: hardTechniques,
    target_difficulty: "hard",
    min_solve_techniques: 2,
});

const old = JSON.parse(readFileSync(path, "utf8"));

old.note =
    "Content restricted to NCERT Class 11 and 12 scope for ALL JEE Main Mathematics units. " +
    "Hard/exam-calibrated generation MUST prefer hard_archetypes and hard_techniques. " +
    "banned_easy_templates must NOT be used as the main ask for hard banks. " +
    "Out-of-NCERT methods appear under constraints and must not be required to solve.";

old["1_Coordinate_Geometry"] = {
    ...old["1_Coordinate_Geometry"],
    ...hardExtras(
        [
            "Locus of a point with two geometric constraints (distance + angle / section + parallel)",
            "Family of lines L1+λL2 through fixed intersection with circle chord condition",
            "Combined circle + line: chord length, power of a point, common-tangent count",
            "Conic focus-directrix condition fused with line/circle constraint",
            "Optimization of a geometric quantity (max/min distance under constraint)",
        ],
        [
            "Direct plug-in of distance formula only",
            "Find centre/radius of a given circle equation only",
            "Simple slope of line joining two points only",
        ],
        [
            "Simultaneous geometric conditions",
            "Parameter elimination for locus",
            "Case splits (parallel vs intersecting; internal vs external)",
        ]
    ),
};

old["2_Limit_Continuity_Differentiability"] = {
    ...old["2_Limit_Continuity_Differentiability"],
    ...hardExtras(
        [
            "0/0 limit needing multi-identity reduction (not a single sinx/x)",
            "Piecewise continuity + differentiability for unknown constants at two or more points",
            "Implicit differentiation + related rates on a curve",
            "Nested logarithmic/chain differentiation with evaluation under constraint",
            "Rolle/MVT style existence with a parameter",
            "Standard-limit expansion path without L'Hopital (multi-step)",
        ],
        [
            "lim sin(kx)/x as x→0 alone",
            "Single chain-rule evaluation f'(a) for a simple composite",
            "Bare assertion-reason on continuity definition only",
        ],
        [
            "Algebraic reduction before standard limits",
            "LHL/RHL casework",
            "Linked differentiation conditions",
        ]
    ),
};

old["3_Integral_Calculus"] = {
    ...old["3_Integral_Calculus"],
    ...hardExtras(
        [
            "Definite integral via King's property + non-obvious simplification (not pure even/odd zero)",
            "Area between curves requiring intersection solve + split integrals",
            "Substitution + integration by parts multi-stage definite integral",
            "Integral-defined F(x) with extrema of F on an interval",
            "Piecewise integrand with symmetry that is NOT trivially odd",
            "Trig/rational form needing identity reduction then standard integral",
        ],
        [
            "∫sin^n cos^m with a single u-sub only (textbook)",
            "∫ of an odd function over symmetric limits = 0 alone",
            "Direct ∫x^n from 0 to b only",
            "Plain antiderivative without multi-step setup",
        ],
        [
            "Property first then integrate",
            "Intersection + area split",
            "Parts + substitution fusion",
        ]
    ),
};

old["4_Matrices_and_Determinants"] = {
    ...old["4_Matrices_and_Determinants"],
    ...hardExtras(
        [
            "Determinant properties + identity proof then numeric evaluation",
            "Consistency of a 3-variable system with parameter λ (unique/infinite/none)",
            "adj(A) and A^{-1} combined identity with one entry computation",
            "Area via determinant + collinearity/orientation constraint",
            "Matrix equation AX=B including singular case analysis",
        ],
        [
            "Compute 2×2 determinant only",
            "Multiply two small matrices only",
            "Find inverse of a diagonal matrix only",
        ],
        [
            "Property-based det reduction",
            "Parameter case split",
            "Adjoint-inverse linkage",
        ]
    ),
};

old["5_Differential_Equations"] = {
    ...old["5_Differential_Equations"],
    ...hardExtras(
        [
            "Form DE from geometric condition (tangent/normal slope) then solve",
            "Linear first-order with integrating factor + initial condition",
            "Homogeneous DE with y=vx and a non-trivial integral",
            "Modeling DE + particular solution evaluated at a point",
            "Formation of order-n DE then solve by separation/linear method",
        ],
        [
            "dy/dx = f(x) direct integrate only",
            "Pure separable with given answer form and no multi-step geometry",
            "Order and degree identification only",
        ],
        [
            "Formation + solution two-stage",
            "Integrating-factor method carefully",
            "Initial-condition evaluation",
        ]
    ),
};

const NEW = {
    "6_Sets_Relations_Functions": {
        ncert_source: "Class 11 Ch1 Sets, Ch2 Relations and Functions",
        concepts: [
            "Sets: roster/set-builder, union, intersection, complement, power set",
            "Venn diagram identities and counting with two/three sets",
            "Relations: domain, range, reflexive, symmetric, transitive, equivalence",
            "Functions: one-one, onto, into, bijective; composition fog",
            "Inverse of a bijective function",
            "Binary operations and identity/inverse elements (NCERT scope)",
        ],
        formulas: [
            "n(A∪B)=n(A)+n(B)-n(A∩B); three-set inclusion-exclusion",
            "(fog)(x)=f(g(x)); (fog)^{-1}=g^{-1}∘f^{-1} when invertible",
            "Number of relations from A to B = 2^{|A|·|B|}",
        ],
        standard_results: [
            "Equivalence relation ⇔ partitions the set",
            "f invertible ⇔ f bijective",
        ],
        allowed_methods: [
            "Set algebra and Venn counting",
            "Definition checks for relation properties",
            "Composition and invertibility tests",
        ],
        common_traps: [
            "Confusing one-one with onto",
            "Forgetting empty set in power set count",
            "Wrong order of composition fog vs gof",
        ],
        jee_patterns: [
            "Counting equivalence relations / number of functions of a type",
            "Composition invertibility multi-step",
            "Three-set survey word problems with constraints",
        ],
        constraints: [
            "Advanced order theory (lattices, partial orders) beyond NCERT not required",
        ],
        difficulty_patterns: [
            "Hard: multi-condition function type + composition + inverse",
            "Hard: three-set counting with inclusion and constraints",
            "Easy banned: single two-set Venn direct plug",
        ],
        ...hardExtras(
            [
                "Number of onto/one-one functions with cardinality constraints",
                "fog bijective conditions with careful logic",
                "Three-set word problem needing inclusion-exclusion + case logic",
            ],
            [
                "n(A∪B) with two given numbers only",
                "Is relation reflexive only",
            ],
            ["Cardinality constraints", "Composition chain", "Case counting"]
        ),
    },
    "7_Complex_Numbers_and_Quadratic_Equations": {
        ncert_source: "Class 11 Ch5 Complex Numbers and Quadratic Equations",
        concepts: [
            "Complex number a+ib, conjugate, modulus, argument",
            "Argand plane, polar form",
            "Multiplication/division in polar form",
            "Quadratic equations over reals and complexes",
            "Nature of roots, sum and product of roots",
            "Formation of quadratic with given roots",
        ],
        formulas: [
            "|z|=sqrt(a²+b²); arg(z) with quadrant care",
            "z·z̄=|z|²; |z1 z2|=|z1||z2|; arg(z1 z2)=arg z1+arg z2",
            "For ax²+bx+c=0: sum=-b/a, product=c/a; D=b²-4ac",
        ],
        standard_results: [
            "Non-real roots of real-coefficient quadratic occur in conjugate pairs",
            "|z1+z2| ≤ |z1|+|z2|",
        ],
        allowed_methods: [
            "Cartesian and polar algebra",
            "Modulus-argument method",
            "Quadratic formula and Vieta",
        ],
        common_traps: [
            "Wrong quadrant for arg",
            "Discriminant sign misread for complex roots",
        ],
        jee_patterns: [
            "Locus |z-z1|/|z-z2|=k in Argand plane",
            "Quadratic with parameter for real roots",
            "Simultaneous modulus and argument conditions",
        ],
        constraints: [
            "Full complex analysis beyond NCERT algebra is out of scope",
        ],
        difficulty_patterns: [
            "Hard: locus + modulus multi-constraint",
            "Hard: parameter quadratic with root conditions",
        ],
        ...hardExtras(
            [
                "Argand locus from two modulus conditions",
                "Quadratic parameter for real roots + inequality",
                "Polar form power with principal argument casework",
            ],
            ["Find |3+4i| only", "Solve x²+1=0 only"],
            ["Locus geometry", "Parameter discriminant", "Argument case split"]
        ),
    },
    "8_Permutations_and_Combinations": {
        ncert_source: "Class 11 Ch7 Permutations and Combinations",
        concepts: [
            "Fundamental principle of counting",
            "P(n,r) and C(n,r) meanings",
            "Permutations with restrictions",
            "Circular permutations (basic)",
            "Combinations with at-least / at-most constraints",
        ],
        formulas: [
            "P(n,r)=n!/(n-r)!; C(n,r)=n!/(r!(n-r)!)",
            "C(n,r)=C(n,n-r); C(n,r)+C(n,r-1)=C(n+1,r)",
        ],
        standard_results: [
            "Complement counting often shorter for 'at least one' problems",
        ],
        allowed_methods: [
            "Casework counting",
            "Complement method",
            "Multiplication and addition principles",
        ],
        common_traps: [
            "P vs C confusion",
            "Overcounting identical objects",
        ],
        jee_patterns: [
            "Digits/letters with separation constraints",
            "At least one via complement",
            "Multi-stage selection with capacity limits",
        ],
        constraints: ["Generating functions not in NCERT"],
        difficulty_patterns: [
            "Hard: multi-constraint casework counting",
            "Easy banned: single C(n,r) plug-in",
        ],
        ...hardExtras(
            [
                "Arrangement with separation conditions",
                "Complement counting multi-condition",
                "Numbers/words with digit restrictions and leading-zero rules",
            ],
            ["Compute C(10,3) only", "Simple P(n,2) only"],
            ["Casework", "Complement", "Restriction chaining"]
        ),
    },
    "9_Binomial_Theorem": {
        ncert_source: "Class 11 Ch8 Binomial Theorem",
        concepts: [
            "Binomial expansion (a+b)^n for positive integral n",
            "General term T_{r+1}",
            "Middle term(s)",
            "Coefficient extraction applications",
        ],
        formulas: [
            "(a+b)^n = Σ C(n,r) a^{n-r} b^r",
            "T_{r+1}=C(n,r) a^{n-r} b^r",
        ],
        standard_results: [
            "Sum of coefficients = (1+1)^n; alternating sum = (1-1)^n",
        ],
        allowed_methods: [
            "General term analysis",
            "Coefficient comparison",
            "Ratio of consecutive terms for greatest term",
        ],
        common_traps: [
            "Off-by-one in general term index",
            "Wrong middle term for even/odd n",
        ],
        jee_patterns: [
            "Coefficient of x^k with multiple contributing terms",
            "Greatest term under numerical condition",
            "Binomial coefficient identities",
        ],
        constraints: [
            "Negative/fractional index full series is beyond core NCERT Main focus here",
        ],
        difficulty_patterns: [
            "Hard: coefficient from constrained general term or product of expansions",
        ],
        ...hardExtras(
            [
                "Coeff of x^k in (ax+b/x)^n with multiple r contributing",
                "Greatest term + numerical condition",
                "Sum of selected coefficients via clever substitution",
            ],
            ["Expand (a+b)^3 only", "Find T2 only"],
            ["General term constraints", "Substitution tricks"]
        ),
    },
    "10_Sequence_and_Series": {
        ncert_source: "Class 11 Ch9 Sequences and Series",
        concepts: [
            "AP: nth term, sum of n terms",
            "GP: nth term, finite and infinite sum |r|<1",
            "AM-GM relation between two positives",
            "Insertion of AMs and GMs",
        ],
        formulas: [
            "AP: a_n=a+(n-1)d; S_n=n/2[2a+(n-1)d]",
            "GP: a_n=ar^{n-1}; S_n=a(r^n-1)/(r-1); S_∞=a/(1-r) for |r|<1",
            "AM≥GM: (a+b)/2 ≥ √(ab) for a,b>0",
        ],
        standard_results: ["AM-GM equality iff a=b for two positives"],
        allowed_methods: [
            "AP/GP term and sum formulas",
            "AM-GM applications",
            "Hybrid sequence analysis",
        ],
        common_traps: [
            "Wrong Sn when r=1",
            "Infinite GP when |r|≥1",
        ],
        jee_patterns: [
            "Mixed AP-GP hybrid sequences",
            "Sum condition solving for n",
            "AM-GM style numerical constraints",
        ],
        constraints: ["Advanced special series beyond NCERT limited"],
        difficulty_patterns: [
            "Hard: hybrid sequence + sum condition multi-step",
        ],
        ...hardExtras(
            [
                "Sequence linking AP and GP properties",
                "Find n from Sn condition (quadratic in n)",
                "AM-GM with equality case analysis",
            ],
            ["Find 10th term of AP only", "Sum of GP with r=2 only"],
            ["Hybrid AP-GP", "Parameter n solve", "Inequality equality"]
        ),
    },
    "11_Three_Dimensional_Geometry": {
        ncert_source: "Class 12 Ch11 Three Dimensional Geometry",
        concepts: [
            "Direction cosines and direction ratios",
            "Equation of a line in space",
            "Angle between two lines",
            "Shortest distance between skew lines",
            "Basic coplanarity conditions (NCERT)",
        ],
        formulas: [
            "cos²α+cos²β+cos²γ=1",
            "cosθ = |d1·d2|/(|d1||d2|)",
            "Shortest distance between skew lines (NCERT form)",
        ],
        standard_results: [
            "Parallel ⇔ DRs proportional; perpendicular ⇔ d1·d2=0",
        ],
        allowed_methods: [
            "DR/DC conversion",
            "Symmetric/parametric form of a line",
            "Skew-distance formula",
        ],
        common_traps: [
            "Treating intersecting lines as skew",
            "Sign errors in SD formula",
        ],
        jee_patterns: [
            "SD between skew lines with non-unit DR",
            "Angle + geometric condition multi-step",
            "Line through a point parallel/perpendicular to given lines",
        ],
        constraints: [
            "Stick to NCERT 3D line content; advanced plane theory only if in syllabus unit",
        ],
        difficulty_patterns: [
            "Hard: skew distance + geometric interpretation multi-step",
        ],
        ...hardExtras(
            [
                "Shortest distance between skew lines with non-normalized DR",
                "Line satisfying two geometric conditions in space",
                "Angle between lines from symmetric equations",
            ],
            ["Find DCs from DRs only", "Angle between i and j only"],
            ["Skew SD", "Multi-condition line", "Vector basics"]
        ),
    },
    "12_Vector_Algebra": {
        ncert_source: "Class 12 Ch10 Vector Algebra",
        concepts: [
            "Vector addition and scalar multiplication",
            "Section formula for vectors",
            "Dot product and projections",
            "Cross product and area of parallelogram",
            "Scalar triple product (basic)",
        ],
        formulas: [
            "a·b=|a||b|cosθ; a×b=|a||b|sinθ n̂",
            "|a×b|²=|a|²|b|²-(a·b)²",
            "[a b c]=a·(b×c)",
        ],
        standard_results: ["a⊥b ⇔ a·b=0; a∥b ⇔ a×b=0"],
        allowed_methods: [
            "Component form i,j,k",
            "Dot/cross identities",
            "Geometric magnitude interpretation",
        ],
        common_traps: [
            "Cross product non-commutativity",
            "Confusing scalar vs vector product results",
        ],
        jee_patterns: [
            "Angle/area from vectors with constraints",
            "Coplanarity via scalar triple product",
            "Projection + perpendicular component multi-step",
        ],
        constraints: ["Advanced vector calculus out of scope"],
        difficulty_patterns: ["Hard: combined dot and cross conditions"],
        ...hardExtras(
            [
                "Vector satisfying simultaneous a·b and a×b conditions",
                "Area/volume via triple product",
                "Unit vector along projection under constraints",
            ],
            [
                "Compute i·j only",
                "Simple |a×b| for perpendicular unit vectors only",
            ],
            ["Dot+cross fusion", "Triple product", "Projection casework"]
        ),
    },
    "13_Statistics_and_Probability": {
        ncert_source: "Class 11 Ch15 Statistics; Class 12 Ch13 Probability",
        concepts: [
            "Mean, median, mode (basic)",
            "Variance and standard deviation",
            "Classical probability",
            "Addition and multiplication theorems",
            "Conditional probability and Bayes theorem",
            "Independent events",
            "Simple probability distributions (NCERT)",
        ],
        formulas: [
            "P(A∪B)=P(A)+P(B)-P(A∩B)",
            "P(A|B)=P(A∩B)/P(B)",
            "Bayes formula for a partition",
            "Var(X)=E(X²)-(E(X))²",
        ],
        standard_results: [
            "Independent A,B ⇒ P(A∩B)=P(A)P(B)",
        ],
        allowed_methods: [
            "Total probability / tree diagrams",
            "Bayes with partition",
            "Variance from frequency data",
        ],
        common_traps: [
            "Mutually exclusive confused with independent",
            "Wrong sample space for conditional probability",
        ],
        jee_patterns: [
            "Multi-stage Bayes",
            "Variance after data scaling/shift",
            "Independent events multi-condition",
        ],
        constraints: [
            "Advanced continuous distributions beyond NCERT not required",
        ],
        difficulty_patterns: [
            "Hard: multi-stage Bayes or combinatorics+probability fusion",
        ],
        ...hardExtras(
            [
                "Bayes with three hypotheses",
                "Probability fused with permutations/combinations constraints",
                "Variance after linear transformation of data",
            ],
            ["Single coin P(H) only", "Mean of 2,4,6 only"],
            ["Bayes multi-stage", "Conditional+independence", "Var transform"]
        ),
    },
    "14_Trigonometry": {
        ncert_source:
            "Class 11 Ch3 Trigonometric Functions; inverse trig as in NCERT",
        concepts: [
            "Trigonometric ratios and identities",
            "Compound and multiple angles",
            "Transformation formulas",
            "Trigonometric equations (general solutions)",
            "Inverse trigonometric functions and principal values",
        ],
        formulas: [
            "sin(A±B), cos(A±B), tan(A±B)",
            "sin2A, cos2A, tan2A; sin3A, cos3A",
            "sum-to-product identities",
            "sin^{-1}x + cos^{-1}x = π/2 on [-1,1]",
        ],
        standard_results: [
            "General solution patterns for sinθ=0, cosθ=0, sinθ=sinα, etc.",
        ],
        allowed_methods: [
            "Identity reduction",
            "Auxiliary angle method",
            "Principal value handling for inverse trig",
        ],
        common_traps: [
            "Wrong general solution",
            "Principal-value branch errors",
        ],
        jee_patterns: [
            "Multi-angle trig equation with interval filter",
            "Expression simplify then evaluate",
            "Inverse trig equation with domain restrictions",
        ],
        constraints: ["Advanced complex trigonometric series out of scope"],
        difficulty_patterns: [
            "Hard: multi-angle equation + domain filter",
            "Easy banned: evaluate sin(π/6) only",
        ],
        ...hardExtras(
            [
                "Trig equation with 2A/3A after identity, then general solution in an interval",
                "Inverse trig expression with principal values",
                "Max/min of a cosθ + b sinθ under constraint",
            ],
            ["Evaluate sin30° only", "Expand sin(A+B) only"],
            ["Multi-angle solve", "Principal value care", "a cos+b sin extrema"]
        ),
    },
};

Object.assign(old, NEW);
writeFileSync(path, JSON.stringify(old, null, 2), "utf8");

const keys = Object.keys(old).filter((k) => k !== "note");
console.log("chapters:", keys.length);
for (const k of keys) {
    const c = old[k];
    console.log(
        k,
        "hard_arch",
        (c.hard_archetypes || []).length,
        "banned",
        (c.banned_easy_templates || []).length
    );
}
