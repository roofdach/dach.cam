/**
 * Things to draw: everyday, drawable, and fine for a classroom. A drawer is
 * offered three at random each turn. The host can add their own on top, or
 * play with only their own.
 */
export const WORDS: readonly string[] = `
airplane, alarm clock, alien, alligator, ambulance, anchor, angel, ant, apple, arm, arrow, astronaut, avocado, axe,
baby, backpack, bacon, badge, ball, balloon, banana, bandage, bank, barn, baseball, basket, basketball, bat, bath,
battery, beach, beard, bed, bee, bell, belt, bench, bicycle, bird, birthday cake, black hole, blanket, boat, bone,
book, boot, bottle, bow, bowl, box, brain, bread, bridge, broccoli, broom, brush, bubble, bucket, bug, bunny, burger,
bus, butterfly, button, cactus, cake, calculator, calendar, camel, camera, campfire, candle, candy, cannon, canoe,
cap, car, carrot, castle, cat, caterpillar, chain, chair, cheese, cherry, chess, chicken, chimney, chocolate,
church, circus, clock, cloud, clown, coat, coconut, coffee, coin, comb, compass, computer, cookie, corn, cow, crab,
crayon, crocodile, crown, cup, cupcake, curtain, dentist, desert, diamond, dice, dinosaur, doctor, dog, dolphin,
donkey, donut, door, dragon, drum, duck, eagle, ear, earth, egg, elbow, elephant, envelope, eraser, eye,
eyebrow, face, fairy, fan, feather, fence, finger, fire, fire truck, fireworks, fish, fishing rod, flag, flamingo,
flashlight, flower, flute, fly, foot, football, forest, fork, fountain, fox, frog, fries, frying pan, garden,
ghost, gift, giraffe, glasses, globe, glove, goat, goldfish, gorilla, grapes, grass, guitar, hair, hamburger,
hammer, hand, hat, headphones, heart, hedgehog, helicopter, helmet, hippo, hockey, honey, horse, hospital,
hot dog, hourglass, house, ice cream, igloo, island, jacket, jellyfish, jigsaw, juice, kangaroo, key, keyboard,
king, kite, kitten, knife, koala, ladder, ladybug, lamp, laptop, leaf, lemon, library, light bulb, lighthouse,
lightning, lion, lips, lizard, lobster, lock, lollipop, magnet, mailbox, map, mask, medal, mermaid, microphone,
microscope, milk, mirror, money, monkey, moon, mountain, mouse, moustache, mouth, mushroom, nail, necklace,
nest, net, nose, notebook, octopus, onion, orange, owl, paint, paintbrush, palm tree, pancake, panda, paper clip,
parachute, parrot, party, peach, peacock, pear, pen, pencil, penguin, phone, piano, pig, pillow, pineapple,
pirate, pizza, planet, plant, plate, playground, pocket, police, popcorn, potato, present, pumpkin, puppy,
queen, rabbit, raccoon, radio, rain, rainbow, rake, robot, rocket, roller coaster, roof, rope, rose, ruler,
sailboat, salt, sandcastle, sandwich, saw, saxophone, scarf, school, scissors, scooter, scorpion, sea, seal,
shark, sheep, shell, ship, shirt, shoe, shovel, shower, skateboard, skeleton, ski, skull, skunk, sleep, slide,
smile, snail, snake, snow, snowman, soap, sock, sofa, soup, spaceship, spider, spider web, spoon, square, squid,
squirrel, stairs, star, starfish, statue, stethoscope, stop sign, strawberry, submarine, sun, sunflower,
sunglasses, superhero, sushi, swan, sweater, swimming pool, sword, table, taco, tail, teacher, teapot, teddy bear,
teeth, telescope, television, tennis, tent, tiger, toaster, toilet, tomato, tongue, toothbrush, tornado, tractor,
traffic light, train, trampoline, treasure, tree, triangle, trophy, truck, trumpet, turtle, umbrella, unicorn,
vampire, violin, volcano, waffle, wallet, watch, waterfall, watermelon, wave, whale, wheel, windmill, window,
witch, wizard, wolf, worm, yo-yo, zebra, zipper, zombie
`
  .split(",")
  .map((word) => word.trim())
  .filter(Boolean);
