import { About } from "@/components/About";
import { Contact } from "@/components/Contact";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Intro } from "@/components/Intro";
import { Projects } from "@/components/Projects";

export default function Home() {
  return (
    <>
      <Header />
      <main className="flex-1">
        <Intro />
        <Projects />
        <About />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
