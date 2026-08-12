// Read-only diagnostic: why isn't a coach showing on /coaches?
// Prints every "Newton" person + their coach publish state, and the full list
// of published coaches. Run via the diagnose-coaches workflow against prod.
import { prisma } from "@/lib/db";

async function main() {
  const newtons = await prisma.person.findMany({
    where: { OR: [{ lastName: { contains: "ewton" } }, { firstName: { contains: "tephanie" } }] },
    include: { coach: true, user: { select: { role: true, extraRoles: true } } },
  });

  console.log("=== Persons matching Stephanie / Newton ===");
  for (const p of newtons) {
    console.log(
      JSON.stringify({
        personId: p.id,
        firstName: JSON.stringify(p.firstName),
        lastName: JSON.stringify(p.lastName),
        hasCoach: !!p.coach,
        publishedOnSite: p.coach?.publishedOnSite ?? null,
        publicHidden: p.coach?.publicHidden ?? null,
        imageUrl: p.imageUrl ? "(set)" : null,
        userRole: p.user?.role ?? null,
      })
    );
  }

  const published = await prisma.coach.findMany({
    where: { publishedOnSite: true },
    include: { person: { select: { firstName: true, lastName: true } } },
    orderBy: { person: { lastName: "asc" } },
  });
  console.log(`\n=== Published coaches (publishedOnSite=true): ${published.length} ===`);
  for (const c of published) {
    console.log(`- ${JSON.stringify(c.person.firstName)} ${JSON.stringify(c.person.lastName)}`);
  }

  const totalCoaches = await prisma.coach.count();
  console.log(`\nTotal coach records: ${totalCoaches}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
