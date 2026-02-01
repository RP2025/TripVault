def pat1(n):
    for i in range(0,n):
        for j in range(n-i,0,-1):
            print("* ",end="")
        print("\r")

pat1(5)

