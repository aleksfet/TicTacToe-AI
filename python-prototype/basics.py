x=4
text= "hi"
text= "2"
numbers = [5,6,12,13,21]
set1 = (1,2,3,4)
user = {
    "name": "aleks",
    "age": 16,
    "height": 178,
    "weight": 'currently bulking'
}
#print(str(x)+text)
print(user["weight"])

if x>5 :
    print("Moreee")
elif x<5 :
    print("Less Bud")
else:
    print("Equalsss")    

for i in numbers:
    print(i)
print('----------------')
for i in range(0,5):
    print(numbers[i])
print('----------------')
for i,v in enumerate(numbers):
    print(i,v)
print('----------------')

# library for making games: pygame

while x>0:
    x-=1
    #sprint(x)
    


map = [
    [1,1,1],
    [0,2,2],
    [0,0,0]
]

# map [i]        [1,1,1]    [0,0,0]    [0,1,2]
# set(map[i])    {1}           {0}        {0,1,2}


for i in range(0,3):
    # horizontal
    if len(set(map[i])) == 1 and set(map[i]) != {0}:
        print('player',str(map[i][0]),'wins')
        break
    for j in range(0,3):
        continue